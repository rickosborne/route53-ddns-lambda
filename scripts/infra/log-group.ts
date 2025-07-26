import { CloudWatchLogs } from "@aws-sdk/client-cloudwatch-logs";
import console from "node:console";
import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";

export class LogGroupDeployable extends Deployable {
	public arn: string | undefined;
	public readonly client: CloudWatchLogs;
	public override readonly dependsOn: DeployableType[] = [];
	public readonly name: string;

	public constructor(
		awsConfig: AwsConfig,
		public readonly lambdaName: string,
	) {
		super(awsConfig);
		this.name = `/aws/lambda/${ lambdaName }`;
		this.client = new CloudWatchLogs({ region: awsConfig.region });
	}

	public async apply(): Promise<void> {
		if (this.arn == null) {
			console.log(`⚡️ Creating CloudWatch Log Group: ${ this.name }`);
			await this.client.createLogGroup({
				logGroupClass: "STANDARD",
				logGroupName: this.name,
			});
			console.log(`✅ Created CloudWatch Log Group: ${ this.name }`);
		}
	}

	public get needApply(): boolean {
		return this.arn == null;
	}

	public async plan(): Promise<void> {
		const logGroups = await this.client.listLogGroups({
			logGroupNamePattern: this.lambdaName,
		})
		this.arn = logGroups.logGroups?.find((lg) => lg.logGroupName === this.name)?.logGroupArn;
		if (this.arn != null) {
			console.log(`CloudWatch Log Group exists: ${ this.name } ${ this.arn }`);
		} else {
			console.log(`CloudWatch Log Group does not exist yet: ${ this.name }`);
		}
	}
}
