export interface LambdaEnv {
	ALLOWED_HOSTNAMES: string;
	ALLOWED_IP_MASKS: string;
	CHANGE_COMMENT_TEMPLATE: string;
	CLIENT_SECRET: string;
	CLIENT_USERNAME: string;
	CODE_SHA256: string;
	DOMAIN_NAME: string;
	HOSTNAME_OVERRIDE: string;
	HOSTNAME_PARAM: string;
	IP_MUST_MATCH_REMOTE_ADDR: string;
	IP_PARAM: string;
	REMOVE_IF_NO_IP: "true" | "false";
	REMOVE_IF_REMOTE_ADDR_IP_MISMATCH: "true" | "false";
	ROUTE53_ZONE_ID: string;
	SECRET_PARAM: string;
	TTL_SECONDS: `${ number }`;
	USERNAME_PARAM: string;
	USE_REMOTE_ADDR_WHEN_NO_IP: "true" | "false";
}
