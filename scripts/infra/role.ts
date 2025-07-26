import { IAM } from "@aws-sdk/client-iam";
import { checkAwsError } from "../util/check-aws-error.js";
import { deepEquals } from "../util/deep-equals.js";
import { type AssumeRolePolicy, AssumeRolePolicyDeployable } from "./assume-role-policy.js";
import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";
import { HostedZoneDeployable } from "./hosted-zone.js";

export class RoleDeployable extends Deployable {
	public arn: string | undefined;
	public assumeRolePolicy: AssumeRolePolicy | undefined;
	public readonly client: IAM;
	public override readonly dependsOn: DeployableType[] = [ HostedZoneDeployable, AssumeRolePolicyDeployable ];
	public roleChange: boolean = true;

	public constructor(
		awsConfig: AwsConfig,
		public readonly name: string,
	) {
		super(awsConfig);
		this.client = new IAM({ region: awsConfig.region });
	}

	public async apply(): Promise<void> {
		const assumeRole = this.requireType(AssumeRolePolicyDeployable);
		if (this.arn == null) {
			const hostedZone = this.requireType(HostedZoneDeployable);
			this.logInfo(`⚡️ Creating Role ${ this.name }`)
			const createdRole = await this.client.createRole({
				AssumeRolePolicyDocument: assumeRole.docJson,
				Description: `Route53DDNSLambda Execution Role for ${ hostedZone.domainName }`,
				RoleName: this.name,
			});
			this.assertDefined(createdRole.Role, "Create Role response");
			this.arn = createdRole.Role.Arn;
			this.assumeRolePolicy = assumeRole.doc;
			this.logInfo(`✅ Created IAM Role: ${ this.name } ${ this.arn }`);
		}
		this.assertDefined(this.assumeRolePolicy, "Assume Role Policy");
		if (!deepEquals(this.assumeRolePolicy, assumeRole.doc)) {
			this.logInfo(`⚡️ Updating the AssumeRolePolicy for Role ${ this.name }`);
			await this.client.updateAssumeRolePolicy({
				PolicyDocument: assumeRole.docJson,
				RoleName: this.name,
			});
			this.logInfo(`✅ Updated the AssumeRolePolicy for Role ${ this.name }`)
		}
	}

	public get needApply(): boolean {
		return this.roleChange;
	}

	public async plan(): Promise<void> {
		const existingRole = (await this.client
			.getRole({ RoleName: this.name })
			.catch(checkAwsError("NoSuchEntityException")))?.Role;
		if (existingRole == null) {
			this.logInfo(`IAM Role does not exist yet: ${ this.name }`);
		} else {
			this.arn = existingRole.Arn;
			if (existingRole.AssumeRolePolicyDocument != null) {
				this.assumeRolePolicy = JSON.parse(decodeURIComponent(existingRole.AssumeRolePolicyDocument));
				const assumeRolePolicy = this.requireType(AssumeRolePolicyDeployable);
				this.roleChange = !deepEquals(this.assumeRolePolicy, assumeRolePolicy.doc);
			}
			this.logInfo(`IAM Role exists: ${ this.name } ${ this.arn }`);
		}
		return undefined;
	}
}
