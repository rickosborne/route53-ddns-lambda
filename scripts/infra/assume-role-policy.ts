import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";

export interface AssumeRoleStatement {
	Action: string;
	Effect: string;
	Principal: {
		Service: string
	}
}

export interface AssumeRolePolicy {
	Statement: AssumeRoleStatement[];
	Version: "2012-10-17";
}

export class AssumeRolePolicyDeployable extends Deployable {
	public override readonly dependsOn: DeployableType[] = [];

	public constructor(awsConfig: AwsConfig) {
		super(awsConfig);
	}

	public async apply(): Promise<void> {
	}

	public get doc(): AssumeRolePolicy {
		return {
			Statement: [ {
				Action: "sts:AssumeRole",
				Effect: "Allow",
				Principal: {
					Service: "lambda.amazonaws.com",
				},
			} ],
			Version: "2012-10-17",
		};
	}

	public get docJson(): string {
		return JSON.stringify(this.doc, undefined, 2);
	}

	public override get needApply(): boolean {
		return false;
	}

	public async plan(): Promise<void> {
	}
}
