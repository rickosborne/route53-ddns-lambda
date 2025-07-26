import { STS } from "@aws-sdk/client-sts";
import { readFileSync, statSync } from "fs";
import * as console from "node:console";
import * as process from "node:process";
import type { LambdaEnv } from "../src/lambda-env.js";
import { AssumeRolePolicyDeployable } from "./infra/assume-role-policy.js";
import type { AwsConfig } from "./infra/aws-config.js";
import { type Deployable, planAll } from "./infra/deployable.js";
import { HostedZoneDeployable } from "./infra/hosted-zone.js";
import { LambdaFunctionPolicyDeployable } from "./infra/lambda-function-policy.js";
import { LambdaFunctionDeployable } from "./infra/lambda-function.js";
import { LogGroupDeployable } from "./infra/log-group.js";
import { RolePolicyDeployable } from "./infra/role-policy.js";
import { RoleDeployable } from "./infra/role.js";
import { bail } from "./util/bail.js";
import { buildFunction } from "./util/build-function.js";
import { checkAwsError } from "./util/check-aws-error.js";
import { type ConfigJson, zConfigJson } from "./util/config-json.js";

const deploy = async (...args: string[]): Promise<void> => {
	const configFile = args.find((_arg, index, argv) => index > 0 && (argv[index - 1] === "--config" || argv[index - 1] === "-c")) ?? "config.json";
	const dryRun = !args.includes("--apply");
	const stats = statSync(configFile, { throwIfNoEntry: false });
	if (stats == null || !stats.isFile()) {
		return bail(`❌ Config file not found: ${ configFile }`);
	}
	const json = JSON.parse(readFileSync(configFile, { encoding: "utf-8" }));
	const maybeConfig = zConfigJson.safeParse(json);
	if (!maybeConfig.success) {
		console.error(`❌ Problems with config: ${ configFile }`);
		for (const issue of maybeConfig.error.issues) {
			console.error("  ".concat(issue.path.join("."), " : ", issue.message));
		}
		process.exit(1);
	}
	const config: ConfigJson = maybeConfig.data;
	if (config.domainName == null && config.route53ZoneId == null) {
		return bail("❌ Either domainName or route53ZoneId must be configured");
	}
	const sts = new STS({ region: config.region });
	const accountId = (await sts.getCallerIdentity().catch(checkAwsError()))?.Account;
	if (accountId == null) {
		return bail("❌ Could not get current account info.  Did you configure your AWS credentials?");
	}
	const codeHash = await buildFunction();
	const awsConfig: AwsConfig = { accountId, region: config.region };
	const hostedZone = new HostedZoneDeployable(awsConfig, config.domainName, config.route53ZoneId);
	await hostedZone.resolve();
	config.domainName ??= hostedZone.requireDomainName;
	config.route53ZoneId ??= hostedZone.requireZoneId;
	const policyName = `${ config.iamRoleName }-update-${ config.domainName.replace(/\./g, "-") }`;
	const role = new RoleDeployable(awsConfig, config.iamRoleName);
	const rolePolicy = new RolePolicyDeployable(awsConfig, config.iamRoleName, policyName);
	const lambdaEnv: LambdaEnv = {
		ALLOWED_HOSTNAMES: config.allowedHostnames?.join(";") ?? "",
		ALLOWED_IP_MASKS: config.allowedIPMasks?.join(";") ?? "",
		CHANGE_COMMENT_TEMPLATE: config.changeCommentTemplate ?? "",
		CLIENT_SECRET: config.clientSecret,
		CLIENT_USERNAME: config.clientUsername ?? "",
		CODE_SHA256: codeHash,
		DOMAIN_NAME: config.domainName,
		HOSTNAME_OVERRIDE: config.hostnameOverride ?? "",
		HOSTNAME_PARAM: config.hostnameParam ?? "",
		IP_MUST_MATCH_REMOTE_ADDR: config.ipMustMatchRemoteAddr ? "true" : "false",
		IP_PARAM: config.ipParam,
		REMOVE_IF_NO_IP: config.removeIfNoIP ? "true" : "false",
		REMOVE_IF_REMOTE_ADDR_IP_MISMATCH: config.removeIfRemoteAddrIPMismatch ? "true" : "false",
		ROUTE53_ZONE_ID: config.route53ZoneId,
		SECRET_PARAM: config.secretParam,
		TTL_SECONDS: `${ config.ttlSeconds }`,
		USE_REMOTE_ADDR_WHEN_NO_IP: config.useRemoteAddrWhenNoIP ? "true" : "false",
		USERNAME_PARAM: config.usernameParam ?? "",
	};
	const lambdaFunction = new LambdaFunctionDeployable(
		awsConfig,
		config.lambdaName,
		lambdaEnv,
		codeHash,
	);
	const assumeRole = new AssumeRolePolicyDeployable(awsConfig);
	const logGroup = new LogGroupDeployable(awsConfig, config.lambdaName);
	const fnPolicy = new LambdaFunctionPolicyDeployable(awsConfig, config.lambdaName);
	const deployables: Deployable[] = [
		assumeRole,
		fnPolicy,
		hostedZone,
		lambdaFunction,
		logGroup,
		role,
		rolePolicy,
	];
	const ordered = (await planAll(deployables)).filter((d) => d.needApply);
	const anyChanges = ordered.length > 0;
	if (dryRun) {
		if (ordered.length > 0) {
			console.log("Configuration changes found:");
			for (const changed of ordered) {
				console.log(`  ${changed.typeName}`);
			}
			console.log("Apply with: npm run deploy -- --apply")
		} else {
			console.log("✅ Configuration looks up-to-date.");
			console.log(`Dynamic DNS webhook:\n${ lambdaFunction.formatUrl(config) }`);
		}
		return;
	}
	if (!anyChanges) {
		console.log("✅ Configuration looks up-to-date.");
		console.log(`Dynamic DNS webhook:\n${ lambdaFunction.formatUrl(config) }`);
		return;
	}
	for (const deployable of ordered) {
		await deployable.apply();
	}
	console.log(`Dynamic DNS webhook:\n${ lambdaFunction.formatUrl(config) }`);
};

deploy(...process.argv.slice(2))
	.catch((err: unknown) => {
		console.error(err);
		return bail("❌ Unknown error");
	});
