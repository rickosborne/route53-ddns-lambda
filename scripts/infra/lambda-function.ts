import { type GetFunctionCommandOutput, Lambda } from "@aws-sdk/client-lambda";
import * as AdmZip from "adm-zip";
import { readFileSync } from "fs";
import console from "node:console";
import type { LambdaEnv } from "../../src/lambda-env.js";
import { checkAwsError } from "../util/check-aws-error.js";
import type { ConfigJson } from "../util/config-json.js";
import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";
import { HostedZoneDeployable } from "./hosted-zone.js";
import { RoleDeployable } from "./role.js";

export class LambdaFunctionDeployable extends Deployable {
	public static codeZip(file: string): Uint8Array {
		const codeZip = new AdmZip.default();
		const code = readFileSync(file, { encoding: "utf-8" });
		codeZip.addFile("index.mjs", Buffer.from(code));
		return codeZip.toBuffer();
	}

	public arn: string | undefined;
	private readonly client: Lambda;
	public codeChanges: boolean = true;
	public configChanges: boolean = true;
	public override readonly dependsOn: DeployableType[] = [ HostedZoneDeployable, RoleDeployable ];
	public existingCodeHash: string | undefined;
	public existingEnv: Record<string, string> | undefined;
	public url: string | undefined;

	public constructor(
		awsConfig: AwsConfig,
		public readonly name: string,
		public readonly env: Readonly<LambdaEnv>,
		public readonly codeHash: string,
	) {
		super(awsConfig);
		this.client = new Lambda({ region: awsConfig.region });
	}

	public async apply(): Promise<void> {
		const hostedZone = this.requireType(HostedZoneDeployable);
		const role = this.requireType(RoleDeployable);
		if (this.arn != null) {
			if (this.codeChanges) {
				this.logInfo(`⚡️ Updating Lambda Function code: ${ this.name }`);
				const updateCode = await this.client.updateFunctionCode({
					FunctionName: this.name,
					Publish: true,
					ZipFile: LambdaFunctionDeployable.codeZip("dist/index.mjs"),
				}).catch(checkAwsError());
				this.assertDefined(updateCode, "UpdateFunctionCode response")
				console.log(`✅ Updated Lambda code: ${ updateCode.FunctionName } ${ updateCode.FunctionArn }`);
				if (this.configChanges) {
					console.log("Sleeping 5 seconds to let Lambda Code changes apply.");
					await new Promise((resolve) => {
						setTimeout(() => resolve(true), 5_000);
					});
				}
			}
			if (this.configChanges) {
				this.logInfo(`⚡️ Updating Lambda Function configuration: ${ this.name }`);
				const updateConfig = await this.client.updateFunctionConfiguration({
					Description: `Dynamic DNS via Route53 for ${ hostedZone.domainName }`,
					FunctionName: this.name,
					Environment: {
						Variables: this.env as unknown as Record<string, string>,
					},
					Role: role.arn,
					Runtime: "nodejs22.x",
					Timeout: 5,
				});
				this.logInfo(`✅ Updated Lambda config: ${ updateConfig.FunctionName } ${ updateConfig.FunctionArn }`);
			}
		} else {
			this.assertDefined(role.arn, "Role ARN");
			console.log(`⚡️ Creating Lambda Function: ${ this.name }`);
			const createdFn = await this.client.createFunction({
				Code: {
					ZipFile: LambdaFunctionDeployable.codeZip("dist/index.mjs"),
				},
				Description: `Route53 Dynamic DNS update handler for ${ hostedZone.domainName }`,
				Environment: {
					Variables: this.env as unknown as Record<string, string>,
				},
				FunctionName: this.name,
				Handler: "index.handleUpdate",
				PackageType: "Zip",
				Publish: true,
				Role: role.arn,
				Runtime: "nodejs22.x",
				Timeout: 5,
			});
			console.log(`✅ Created Lambda Function: ${ createdFn.FunctionName } ${ createdFn.FunctionArn }`);
		}
		if (this.url == null) {
			const createdUrl = await this.client.createFunctionUrlConfig({
				AuthType: "NONE",
				FunctionName: this.name,
				InvokeMode: "BUFFERED",
			});
			this.url = createdUrl.FunctionUrl;
		}
	}

	public formatUrl(config: ConfigJson): string {
		this.assertDefined(this.url, "URL");
		const queryParams = [
			`${ config.ipParam }=__IP__`,
			`${ config.secretParam }=__SECRET__`,
			...(config.usernameParam == null ? [] : [ `${ config.usernameParam }=__USERNAME__` ]),
			...(config.hostnameOverride == null ? [ `${ config.hostnameParam }=__HOSTNAME__` ] : []),
		];
		return this.url.concat("?", queryParams.join("&"));
	}

	public get needApply(): boolean {
		return this.arn == null || this.configChanges || this.codeChanges;
	}

	public async plan(): Promise<void> {
		const existingFn: GetFunctionCommandOutput | undefined = await this.client
			.getFunction({ FunctionName: this.name })
			.catch(checkAwsError("ResourceNotFoundException"));
		if (existingFn == null || existingFn.Configuration == null) {
			console.log(`Lambda Function does not exist yet: ${ this.name }`);
		} else {
			this.arn = existingFn.Configuration.FunctionArn;
			console.log(`Lambda Function exists: ${ this.name } ${ this.arn }`);
			this.existingEnv = existingFn.Configuration?.Environment?.Variables;
		}
		if (existingFn != null) {
			const existingEnv = this.existingEnv ?? {};
			this.existingCodeHash = this.existingEnv?.CODE_SHA256;
			const different = Object.entries(this.env)
				.map(([ key, expected ]: [ string, string ]): [ string, string, string | undefined ] => [ key, expected, existingEnv[key] ])
				.filter(([ _key, expected, actual ]) => actual !== expected);
			if (this.existingCodeHash == null || different.length > 0) {
				console.log("Configuration change:")
				for (const [ key, expected, actual ] of different) {
					console.log(`  ${ key }: ${ actual == null ? "(none)" : JSON.stringify(actual) } => ${ JSON.stringify(expected) }`);
				}
				if (!different.some(([ key ]) => key === "CODE_SHA256")) {
					this.codeChanges = false;
				}
			} else if (this.existingCodeHash !== this.codeHash) {
				console.log(`Code hash has changed: ${ this.existingCodeHash } => ${ this.codeHash }`);
				this.codeChanges = true;
			} else {
				console.log("No Lambda configuration changes.");
				this.configChanges = false;
				this.codeChanges = false;
			}
			const urlConfig = await this.client.getFunctionUrlConfig({
				FunctionName: this.name,
			}).catch(checkAwsError("ResourceNotFoundException"));
			if (urlConfig != null) {
				this.url = urlConfig.FunctionUrl;
			}
		} else {
			console.log(`Will deploy Lambda Function ${ this.name } with configuration:`);
			for (const [ key, value ] of Object.entries(this.env)) {
				console.log(`  ${ key }: ${ JSON.stringify(value) }`)
			}
		}
	}
}
