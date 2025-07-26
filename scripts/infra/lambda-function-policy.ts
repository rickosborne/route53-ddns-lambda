import { Lambda } from "@aws-sdk/client-lambda";
import console from "node:console";
import { checkAwsError } from "../util/check-aws-error.js";
import { deepEquals } from "../util/deep-equals.js";
import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";

export interface LambdaFunctionPolicyStatement {
	Action: string;
	Condition: {
		StringEquals: Record<string, string>;
	}
	Effect: string;
	Principal: string;
	Resource: string;
	Sid: string;
}

export interface LambdaFunctionPolicy {
	Id: "default";
	Statement: LambdaFunctionPolicyStatement[];
	Version: "2012-10-17";
}

export class LambdaFunctionPolicyDeployable extends Deployable {
	public readonly client: Lambda;
	public override readonly dependsOn: DeployableType[] = [];
	public existingPolicyDoc: LambdaFunctionPolicy | undefined;
	public policyChange: boolean = true;

	public constructor(
		awsConfig: AwsConfig,
		public readonly lambdaName: string,
	) {
		super(awsConfig);
		this.client = new Lambda({ region: awsConfig.region })
	}

	public async apply(): Promise<void> {
		if (!this.policyChange) {
			return;
		}
		if (this.existingPolicyDoc != null && Array.isArray(this.existingPolicyDoc.Statement)) {
			for (const statement of this.existingPolicyDoc.Statement) {
				if (statement.Sid != null) {
					this.logInfo(`⚡️ Removing obsolete Function Policy: ${ this.existingPolicyDoc.Id } / ${ statement.Sid }`);
					await this.client.removePermission({
						FunctionName: this.lambdaName,
						StatementId: statement.Sid,
					});
				}
			}
		}
		this.logInfo(`⚡️ Creating Function Policy: ${ this.lambdaName }`);
		await this.client.addPermission({
			Action: "lambda:InvokeFunctionUrl",
			FunctionName: this.lambdaName,
			FunctionUrlAuthType: "NONE",
			Principal: "*",
			StatementId: "FunctionURLAllowPublicAccess",
		});
		console.log(`✅ Created Function Policy: ${ this.lambdaName }`);
	}

	public get doc(): LambdaFunctionPolicy {
		return {
			Version: "2012-10-17",
			Id: "default",
			Statement: [
				{
					Action: "lambda:InvokeFunctionUrl",
					Effect: "Allow",
					Principal: "*",
					Sid: "FunctionURLAllowPublicAccess",
					Resource: `arn:aws:lambda:${ this.awsConfig.region }:${ this.awsConfig.accountId }:function:${ this.lambdaName }`,
					Condition: {
						StringEquals: {
							"lambda:FunctionUrlAuthType": "NONE",
						},
					},
				},
			],
		}
	}

	public get needApply(): boolean {
		return this.policyChange;
	}

	public async plan(): Promise<void> {
		const existingFnPolicy = await this.client.getPolicy({
			FunctionName: this.lambdaName,
		}).catch(checkAwsError("ResourceNotFoundException"));
		if (existingFnPolicy == null) {
			console.log("Function policy does not exist yet.")
		} else {
			this.assertDefined(existingFnPolicy.Policy, "Existing Policy Document");
			this.existingPolicyDoc = JSON.parse(existingFnPolicy.Policy);
			this.policyChange = !deepEquals(this.existingPolicyDoc, this.doc);
		}
	}
}
