import process from "node:process";
import { boolean as zBoolean, infer as zInfer, number as zNumber, object as zObject, string as zString } from "zod";

const ZONE_ID_PATTERN = /^[A-Z0-9]+$/;
const ALPHA_NUM_PATTERN = /^[a-zA-Z0-9]+$/;
const ROLE_PATTERN = /^[-_a-zA-Z0-9]+$/;
const REGION_PATTERN = /^[a-z]+-[a-z]+-[1-9]$/;
const LAMBDA_NAME_PATTERN = /^[-_a-zA-Z0-9]{1,140}$/;
const HOSTNAME_PATTERN = /^[a-z][-a-z0-9]*$/;
const DOMAIN_PATTERN = /^([a-z][-a-z0-9]*)([.]([a-z][-a-z0-9]*))+$/;
const USERNAME_PATTERN = /^[@.a-zA-Z0-9]+$/;
const SECRET_PATTERN = /^[-+/_a-zA-Z0-9]{30,}$/;
const CIDR_PATTERN = /^(1?[0-9]{1,2}|2[0-5][0-9])[.](1?[0-9]{1,2}|2[0-5][0-9])[.](1?[0-9]{1,2}|2[0-5][0-9])[.](1?[0-9]{1,2}|2[0-5][0-9])(\/([12]?[0-9]|3[012]))?$/;
const getEnv = (name: string): string | undefined => {
	const value = process.env[name]?.trim();
	return value == null || value === "" ? undefined : value;
};
export const zConfigJson = zObject({
	$schema: zString().optional(),
	allowedHostnames: zString().regex(HOSTNAME_PATTERN).array().optional(),
	allowedIPMasks: zString().regex(CIDR_PATTERN).array().optional(),
	changeCommentTemplate: zString().nullable().optional().default(null),
	clientSecret: zString().regex(SECRET_PATTERN),
	clientUsername: zString().regex(USERNAME_PATTERN).nullable().optional().default(null),
	domainName: zString().regex(DOMAIN_PATTERN).optional(),
	hostnameOverride: zString().regex(HOSTNAME_PATTERN).optional(),
	hostnameParam: zString().regex(ALPHA_NUM_PATTERN).nullable().optional().default("hostname"),
	iamRoleName: zString().regex(ROLE_PATTERN).optional().default("route53-dynamic-dns-lambda"),
	ipMustMatchRemoteAddr: zBoolean().optional().default(true),
	ipParam: zString().regex(ALPHA_NUM_PATTERN).optional().default("ip"),
	lambdaName: zString().regex(LAMBDA_NAME_PATTERN).optional().default("route53DynamicDNS"),
	region: zString().regex(REGION_PATTERN).optional().default(getEnv("AWS_REGION") ?? "us-east-1"),
	removeIfNoIP: zBoolean().optional().default(false),
	removeIfRemoteAddrIPMismatch: zBoolean().optional().default(false),
	route53ZoneId: zString().regex(ZONE_ID_PATTERN).optional(),
	secretParam: zString().regex(ALPHA_NUM_PATTERN).optional().default("secret"),
	ttlSeconds: zNumber().int().min(1).optional().default(900),
	useRemoteAddrWhenNoIP: zBoolean().optional().default(false),
	usernameParam: zString().regex(ALPHA_NUM_PATTERN).nullable().optional().default(null),
});

export interface ConfigJson extends zInfer<typeof zConfigJson> {
}
