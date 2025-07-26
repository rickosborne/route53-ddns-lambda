import { Route53 } from "@aws-sdk/client-route-53";
import console from "node:console";
import { checkAwsError } from "../util/check-aws-error.js";
import type { AwsConfig } from "./aws-config.js";
import { Deployable, type DeployableType } from "./deployable.js";

export class HostedZoneDeployable extends Deployable {
	public readonly client: Route53;
	public override readonly dependsOn: DeployableType[] = [];
	public domainName: string | undefined;
	public fqdn: string | undefined;
	public hostedZoneId: string | undefined;

	public constructor(
		awsConfig: AwsConfig,
		domainName: string | undefined,
		hostedZoneId: string | undefined,
	) {
		super(awsConfig);
		this.client = new Route53({ region: awsConfig.region });
		this.domainName = domainName?.replace(/\.$/, "");
		this.hostedZoneId = hostedZoneId;
	}

	public async apply(): Promise<void> {
	}

	public async plan(): Promise<void> {
	}

	public override get needApply(): boolean {
		return false;
	}

	public get requireDomainName(): string {
		this.assertDefined(this.domainName, "Domain Name");
		return this.domainName;
	}

	public get requireZoneId(): string {
		this.assertDefined(this.hostedZoneId, "Hosted Zone ID");
		return this.hostedZoneId;
	}

	public async resolve(): Promise<void> {
		if (this.domainName != null && this.hostedZoneId != null) {
			// do nothing
		} else if (this.hostedZoneId != null) {
			const zone = await this.client
				.getHostedZone({ Id: this.hostedZoneId })
				.catch(checkAwsError());
			const domainName = zone?.HostedZone?.Name?.replace(/\.$/, "");
			if (domainName == null) {
				throw new Error(`❌ Could not find domain name for hosted zone ${ this.hostedZoneId }`);
			}
			if (this.domainName == null) {
				this.domainName = domainName;
				this.fqdn = domainName.concat(".");
			} else if (this.domainName !== domainName) {
				throw new Error(`❌ Configured domain name ${ JSON.stringify(this.domainName) } does not match ${ domainName } for hosted zone ${ this.hostedZoneId }`);
			}
		} else if (this.domainName != null) {
			this.fqdn = this.domainName.concat(".");
			const zones = await this.client
				.listHostedZonesByName()
				.catch(checkAwsError());
			const zone = zones?.HostedZones?.find((z) => z.Name === this.domainName || z.Name === this.fqdn);
			if (zone == null || zone.Id == null) {
				throw new Error(`❌ Could not find hosted zone with name: ${ this.domainName }`);
			}
			this.hostedZoneId = zone.Id.replace("/hostedzone/", "");
		} else {
			throw new Error("❌ Either domainName or route53ZoneId must be configured");
		}
		console.log(`Hosted zone ${ this.domainName } = ${ this.hostedZoneId }`);
	}
}
