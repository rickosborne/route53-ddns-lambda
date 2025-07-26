import { IAM, type ListPoliciesCommandOutput, type PolicyVersion } from "@aws-sdk/client-iam";
import console from "node:console";
import { checkAwsError } from "../util/check-aws-error.js";
import { deepEquals } from "../util/deep-equals.js";
import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";
import { HostedZoneDeployable } from "./hosted-zone.js";

export interface RolePolicyStatement {
	Action: string[];
	Effect: string;
	Resource: string;
}

export interface RolePolicy {
	Statement: RolePolicyStatement[];
	Version: "2012-10-17";
}

export class RolePolicyDeployable extends Deployable {
	public readonly client: IAM;
	public override readonly dependsOn: DeployableType[] = [ HostedZoneDeployable ];
	public existingPolicyDoc: RolePolicy | undefined;
	public policyArn: string | undefined;

	public constructor(
		awsConfig: AwsConfig,
		public readonly roleName: string,
		public readonly policyName: string,
	) {
		super(awsConfig)
		this.client = new IAM({ region: awsConfig.region });
	}

	public async apply(): Promise<void> {
		let shouldAttachPolicy = false;
		if (this.policyArn == null) {
			const hostedZone = this.requireType(HostedZoneDeployable);
			this.logInfo(`⚡️ Creating Policy: ${ this.policyName } = ${ this.docJson }`);
			const createdPolicy = await this.client.createPolicy({
				Description: `Route53DDNSLambda Route53 update policy for ${ hostedZone.domainName }`,
				PolicyDocument: this.docJson,
				PolicyName: this.policyName,
			});
			this.assertDefined(createdPolicy.Policy, "Create Policy response");
			this.policyArn = createdPolicy.Policy.Arn;
			if (this.policyArn == null) {
				throw new Error(`❌ Could not find the ARN for Policy: ${ this.policyName }`);
			}
			this.logInfo(`✅ Created IAM Policy: ${ createdPolicy.Policy.PolicyName } ${ this.policyArn }`);
			shouldAttachPolicy = true;
		} else {
			if (this.existingPolicyDoc == null || !deepEquals(this.existingPolicyDoc, this.doc)) {
				console.log(`⚡️ Updating Policy ${ this.policyName }`);
				const updatedPolicy = await this.client.createPolicyVersion({
					PolicyArn: this.policyArn,
					PolicyDocument: this.docJson,
					SetAsDefault: true,
				});
				this.assertDefined(updatedPolicy.PolicyVersion, "Update Policy response");
				console.log(`✅ Updated Policy ${ this.policyName } ${ updatedPolicy.PolicyVersion.VersionId }`);
			}
		}
		if (shouldAttachPolicy) {
			console.log(`⚡️ Attaching Policy ${ this.policyName } to Role ${ this.roleName }`);
			await this.client.attachRolePolicy({
				PolicyArn: this.policyArn,
				RoleName: this.roleName,
			});
			console.log(`✅ Attached Policy ${ this.policyName } to Role ${ this.roleName }`);
		}
	}

	public get doc(): RolePolicy {
		const hostedZoneId = this.requireType(HostedZoneDeployable).requireZoneId;
		return {
			Statement: [ {
				Action: [
					"route53:ChangeResourceRecordSets",
					"route53:ListResourceRecordSets",
				],
				Effect: "Allow",
				Resource: `arn:aws:route53:::hostedzone/${ hostedZoneId }`,
			}, {
				// See: https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaBasicExecutionRole.html
				Action: [
					"logs:CreateLogGroup",
					"logs:CreateLogStream",
					"logs:PutLogEvents",
				],
				Effect: "Allow",
				Resource: "*",
			} ],
			Version: "2012-10-17",
		}
	}

	public get docJson(): string {
		return JSON.stringify(this.doc, undefined, 2);
	}

	public get needApply(): boolean {
		return this.existingPolicyDoc == null || this.policyArn == null;
	}

	public async plan(): Promise<void> {
		let existingPolicy = await this.client.getRolePolicy({
			PolicyName: this.policyName,
			RoleName: this.roleName,
		}).catch(checkAwsError("NoSuchEntityException"));
		if (existingPolicy == null || this.policyArn == null) {
			let marker: string | undefined = undefined;
			let done = false;
			while (!done) {
				const policies: ListPoliciesCommandOutput = await this.client.listPolicies({
					Marker: marker,
				});
				marker = policies.Marker;
				if (policies.IsTruncated !== true || marker == null) {
					done = true;
				}
				if (policies.Policies == null) {
					done = true;
				} else {
					const policy = policies.Policies.find((p) => p.PolicyName === this.policyName);
					if (policy != null) {
						this.policyArn = policy.Arn;
						done = true;
					}
				}
			}
		} else {
			this.assertDefined(existingPolicy.PolicyDocument, "Existing Policy Document");
			this.existingPolicyDoc = JSON.parse(decodeURIComponent(existingPolicy.PolicyDocument));
		}
		if (this.policyArn == null) {
			this.logInfo(`IAM Policy does not exist yet: ${ this.policyName }`);
		} else {
			this.logInfo(`IAM Policy exists: ${ this.policyName } ${ this.policyArn }`);
		}
		if (this.existingPolicyDoc == null && this.policyArn != null) {
			const policyVersions = (await this.client.listPolicyVersions({
				PolicyArn: this.policyArn,
			}))?.Versions ?? [];
			const policyVersion: PolicyVersion | undefined = policyVersions
				.find((v) => v.IsDefaultVersion) ?? policyVersions
				.sort((a, b) => a.CreateDate == null ? 1 : b.CreateDate == null ? -1 : b.CreateDate.valueOf() - a.CreateDate.valueOf())[0] ?? undefined;
			if (policyVersion?.Document != null) {
				this.existingPolicyDoc = JSON.parse(decodeURIComponent(policyVersion.Document));
			} else if (policyVersion != null) {
				const version = (await this.client.getPolicyVersion({
					PolicyArn: this.policyArn,
					VersionId: policyVersion.VersionId,
				})).PolicyVersion;
				this.assertDefined(version?.Document, "Get Policy Version Document");
				this.existingPolicyDoc = JSON.parse(decodeURIComponent(version.Document));
			}
		}
	}
}
