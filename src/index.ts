import { Route53 } from "@aws-sdk/client-route-53";
import type { ResourceRecord, ResourceRecordSet } from "@aws-sdk/client-route-53/dist-types/models/models_0.js";
import type { APIGatewayEventRequestContextV2, APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda";
import * as console from "node:console";
import { BlockList } from "node:net";
import * as process from "node:process";

const HOSTNAME_PATTERN = /^[a-z][-a-z0-9]*$/;
const IP_PATTERN = /^(1?[0-9]{1,2}|2[0-5][0-9])\.(1?[0-9]{1,2}|2[0-5][0-9])\.(1?[0-9]{1,2}|2[0-5][0-9])\.(1?[0-9]{1,2}|2[0-5][0-9])$/;

const getEnv = (name: string): string | null => {
	const value = process.env[name]?.trim();
	return value == null || value === "" ? null : value;
};

const mapEnv = <T>(name: string, mapper: (value: string) => T): T | null => {
	const value = getEnv(name);
	return value == null ? null : mapper(value);
};

const boolEnv = (name: string, defaultValue: boolean): boolean => {
	const value = getEnv(name);
	return value == null ? defaultValue : (value === "true" || value === "1");
};

const config = {
	allowedHostnames: (getEnv("ALLOWED_HOSTNAMES") ?? "")
		.split(/\s*;\s*/g),
	allowedIpMasks: (getEnv("ALLOWED_IP_MASKS") ?? "0.0.0.0/0")
		.split(/\s*;\s*/g)
		.reduce((list, cidr) => {
			const [ ip, mask ] = cidr.split("/");
			list.addSubnet(ip, Number.parseInt(mask, 10));
			return list;
		}, new BlockList()),
	changeCommentTemplate: getEnv("CHANGE_COMMENT_TEMPLATE"),
	clientSecret: getEnv("CLIENT_SECRET"),
	clientUsername: getEnv("CLIENT_USERNAME"),
	domainName: getEnv("DOMAIN_NAME"),
	hostnameOverride: getEnv("HOSTNAME_OVERRIDE"),
	hostnameParam: getEnv("HOSTNAME_PARAM") ?? "hostname",
	ipMustMatchRemoteAddr: boolEnv("IP_MUST_MATCH_REMOTE_ADDR", true),
	ipParam: getEnv("IP_PARAM") ?? "ip",
	removeIfNoIp: boolEnv("REMOVE_IF_NO_IP", false),
	removeIfRemoteAddrIpMismatch: boolEnv("REMOVE_IF_REMOTE_ADDR_IP_MISMATCH", false),
	route53ZoneId: getEnv("ROUTE53_ZONE_ID"),
	secretParam: getEnv("SECRET_PARAM") ?? "secret",
	ttlSeconds: mapEnv("TTL_SECONDS", (s) => Number.parseInt(s, 10)) ?? 900,
	useRemoteAddrWhenNoIp: boolEnv("USE_REMOTE_ADDR_WHEN_NO_IP", false),
	usernameParam: getEnv("USERNAME_PARAM") ?? "username",
};
const { clientSecret: _clientSecret, ...configWithoutSecret } = config;
console.log({ config: configWithoutSecret, message: "Loaded configuration" });

if (config.route53ZoneId == null) {
	console.error({ message: "Missing expected env ROUTE53_ZONE_ID" });
}
if (config.clientSecret == null) {
	console.error({ message: "Missing expected env CLIENT_SECRET" });
}
if (config.domainName == null) {
	console.error({ message: "Missing expected env DOMAIN_NAME" });
}

const fail = (body: string, statusCode: number, message = body): APIGatewayProxyResult => {
	console.error({ body, message, statusCode });
	return {
		body,
		headers: {
			"content-type": "text/plain",
		},
		statusCode,
	};
};

let client: Route53 | undefined = undefined;

// noinspection JSUnusedGlobalSymbols
export const handleUpdate = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResult> => {
	try {
		console.log(event, { depth: 10 });
		if (event == null || event.queryStringParameters == null) {
			return fail("Bad Request", 400, "Event or queryStringParameters was null")
		}
		if (config.route53ZoneId == null || config.domainName == null || config.clientSecret == null) {
			return fail("Misconfigured", 500, "Invalid configuration");
		}
		const queryParams = event.queryStringParameters ?? {};
		const requestContext: APIGatewayEventRequestContextV2 = event.requestContext;
		let remoteAddr = requestContext.http?.sourceIp;
		if ("identity" in requestContext && typeof requestContext.identity === "object" && requestContext.identity != null && "sourceIp" in requestContext.identity && typeof requestContext.identity.sourceIp === "string") {
			remoteAddr = requestContext.identity.sourceIp;
		}
		if (remoteAddr == null) {
			console.warn({ message: "Could not determine RemoteAddr" });
		}
		const hostname = config.hostnameOverride ?? queryParams[config.hostnameParam] ?? undefined;
		const username = queryParams[config.usernameParam] ?? undefined;
		const password = queryParams[config.secretParam] ?? undefined;
		const ip = queryParams[config.ipParam] ?? (config.useRemoteAddrWhenNoIp ? remoteAddr : undefined) ?? undefined;
		console.log({ hostname, ip, message: "Request", username, remoteAddr });
		if (password !== config.clientSecret) {
			return fail("Unauthorized", 403);
		}
		if (ip == null || !IP_PATTERN.test(ip)) {
			return fail("Bad request: IP", 400);
		}
		if (config.allowedIpMasks != null && !config.allowedIpMasks.check(ip)) {
			return fail("IP Out of Range", 400, ip);
		}
		if (hostname == null || !HOSTNAME_PATTERN.test(hostname) || (config.allowedHostnames.length > 0 && !config.allowedHostnames.includes(hostname))) {
			return fail("Unauthorized hostname", 403);
		}
		if (config.clientUsername != null && username !== config.clientUsername) {
			return fail("Unauthorized username", 403);
		}
		let fqdn = hostname.includes(".".concat(config.domainName)) ? hostname : hostname.concat(".", config.domainName);
		if (!fqdn.endsWith(".")) {
			fqdn = fqdn.concat(".");
		}
		client ??= new Route53();
		const listResult = await client.listResourceRecordSets({
			HostedZoneId: config.route53ZoneId,
			MaxItems: 1,
			StartRecordName: fqdn,
			StartRecordType: "A",
		})
			.catch((error) => {
				console.error({ error, hostname, message: "Failed to list records", zoneId: config.route53ZoneId })
				return undefined;
			});
		if (listResult == null || !Array.isArray(listResult.ResourceRecordSets)) {
			return fail("Server failure", 500, "List records failed");
		}
		let existing: ResourceRecordSet | undefined = undefined;
		for (let resourceRecordSet of listResult.ResourceRecordSets ?? []) {
			if (resourceRecordSet.Name === fqdn && resourceRecordSet.Type === "A") {
				existing = resourceRecordSet;
				console.log({ resourceRecordSet, message: "Matched RecordSet" });
			} else {
				console.log({ resourceRecordSet, message: "Unmatched RecordSet" });
			}
		}
		if (existing != null && existing.ResourceRecords != null) {
			const same = existing.ResourceRecords?.find((rr: ResourceRecord) => rr.Value === ip);
			if (same != null) {
				return {
					body: JSON.stringify({
						fqdn,
						ip,
						message: "No change",
					}),
					headers: {
						"content-type": "application/json",
					},
					statusCode: 200,
				};
			}
		}
		console.log({ hostname, message: "Hostname not found" });
		let comment: string | undefined = undefined;
		if (config.changeCommentTemplate != null) {
			comment = config.changeCommentTemplate
				.replace(/\$\{ip}/g, ip)
				.replace(/\$\{hostname}/, hostname)
				.replace(/\$\{username}/, username ?? "(no username)")
		}
		const changeResult = await client.changeResourceRecordSets({
			ChangeBatch: {
				...(comment == null ? {} : { Comment: comment }),
				Changes: [ {
					Action: "UPSERT",
					ResourceRecordSet: {
						Name: fqdn,
						ResourceRecords: [ {
							Value: ip,
						} ],
						Type: "A",
						TTL: config.ttlSeconds,
					},
				} ],
			},
			HostedZoneId: config.route53ZoneId,
		}).catch((error) => {
			console.error({ error, message: "Failed to update Route53", zoneId: config.route53ZoneId })
			return undefined;
		});
		if (changeResult == null) {
			return fail("Update failed", 502);
		}
		console.log({ changeResult, message: "Updated" });
		return {
			body: JSON.stringify({
				fqdn,
				id: changeResult.ChangeInfo?.Id ?? null,
				ip,
				message: "Updated",
				status: changeResult.ChangeInfo?.Status ?? null,
				submittedAt: changeResult.ChangeInfo?.SubmittedAt?.toISOString() ?? null,
			}),
			headers: {
				"content-type": "application/json",
			},
			statusCode: changeResult.ChangeInfo?.Status === "PENDING" ? 202 : 200,
		};
	} catch (err) {
		console.error({ error: err, message: "Unhandled error" });
		return fail("Unhandled Error", 500, err instanceof Error ? `${ err.name }: ${ err.message }` : undefined);
	}
};
