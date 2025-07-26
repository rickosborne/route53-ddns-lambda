# route53-ddns-lambda

This is a proof-of-concept dynamic DNS system built on AWS Route53 and Lambda.

## Requirements

You'll need an AWS account and an existing domain and Hosted Zone.
For deployment, not runtime, you'll need credentials for a Role/User which can deploy and manage Lambdas, Roles, Log Groups, and Policies.
If you already use CloudFormation, Terraform, or similar, you probably already have these.

Everything else (Lambdas, Roles, Policies, etc.) is set up by the `deploy` script in this repo.

## Questions

### Why would I use this?

Eh.  You probably shouldn't?

There are plenty of third-party dynamic DNS offerings, many of which are free for a few hosts, and have built-in support from major router firmware vendors.

But, if you don't want to use those, maybe this is of interest to you.

### Is this production-ready?

Ha.  No.

I mean, I use it in production.
But I wrote it.
And I don't use it for critical systems.

You are, of course, free to review the code and see if it clears your minimum bar.

### What does this deploy?

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
   Route53 Zone     This should already be configured by you and active.
└ ─ ─ ─ ─ ─ ─ ─ ─ ┘
┌─────────────────┐   ┌───────────────────┐
│ Lambda Function │─┬─│ AssumeRole Policy │
└─────────────────┘ │ └───────────────────┘
         │          │ ┌───────────────────┐
         │          ├─│  Function Policy  │
         │          │ ├───────────────────┴──────┐
         │          │ │ lambda:InvokeFunctionUrl │
         │          │ └──────────────────────────┘
         │          │ ┌──────────┐   ┌─────────────┐
         │          └─│ IAM Role │───│ Role Policy │
         │            └──────────┘   ├─────────────┴────────────────────┐
┌─────────────────┐                  │ route53:ChangeResourceRecordSets │
│    Log Group    │                  │ route53:ListResourceRecordSets   │
└─────────────────┘                  │ logs:CreateLogGroup              │
                                     │ logs:CreateLogStream             │
                                     │ logs:PutLogEvents                │
                                     └──────────────────────────────────┘
```

You have some control over the names of these resources, as detailed in [Configuration](#configuration).

This code does not deploy an API Gateway or anything via CloudFront.
If you want pretty URLs, you'll need to set those up on your own.

### Why doesn't it use CloudFormation / Terraform / fairy dust?

I don't want to spend the brainpower to make this bulletproof for all possible cloud deployment systems.
You are quite welcome to fork this repo and add your favorite deployment DSL.

Also, I wanted to get a feel for the level of complexity of deploying a relatively simple set of resources using low-level AWS SDK calls.
tl;dr: I hate it.
As annoying as CF and TF can be, they're still far better than working with the SDK, even for just this handful of resources.

## Usage

1. Set up your local environment:
   ```shell
   git clone git@github.com:rickosborne/route53-ddns-lambda.git
   cd route53-ddns-lambda
   npm ci
   ```
2. Create a `config.json` file, as detailed in [Configuration](#configuration).
3. Have the `deploy` script assess what needs to be done:
   ```shell
   npm run deploy
   ```
   Don't worry.  That won't actually deploy anything yet.
4. Review the output to make sure it's not going to do anything you don't expect.
5. When you're ready:
   ```shell
   npm run deploy -- --apply
   ```
   In addition to the other logging, you'll end up with a console message something like:
   ```
   Dynamic DNS webhook:
   https://abc123.lambda-url.us-east-1.on.aws/?ip=__IP__&secret=__SECRET__&host=__HOSTNAME__
   ```
   This may change considerably, based on your configuration in the next section.
6. Copy and paste this URL into your client, likely your router's DDNS configuration page.
7. Modify those `__*__` placeholders with the ones your client uses.
   For example, FreshTomato uses `@IP` for the IP address, so its query string param above would look like `ip=@IP`.
   Don't forget to replace `__SECRET__` with the value you generated above!

## Configuration

Configuration is done via a `config.json` file.
For a quick example, see [config.example.json](./config.example.json).

For low-level details, see the JSON Schema in [schema/config.schema.json](./schema/config.schema.json).

### Required configuration options

#### `clientSecret`

This should be a random string of base64-compatible characters.
That is, `-+/_a-zA-Z0-9`.
It must be at least 30 characters long.

You can generate one via:

```shell
openssl rand -base64 30
```

Your clients will need to include this value in query parameters.
See [`secretParam`](#secretparam) for details.

#### `domainName` or `route53ZoneId`

You must supply at least one of these.
The domain name will be something like `example.com` (with or without the trailing `.`), while the Hosted Zone ID can be obtained via the AWS Console.

### Build & deploy configuration options

#### `iamRoleName`

The name for the Role the Lambda will use to manage the Route53 records, which must be unique among your Roles.
If not supplied, the default is `route53-dynamic-dns-lambda`.

Example: `"iamRoleName": "example-com-dynamic-dns-lambda-role"`

#### `lambdaName`

The Function Name of the Lambda, which must be unique among your Lambdas.
If not supplied, the default is `route53DynamicDNS`.

Example: `"lambdaName": "example-com-dynamic-dns"`

#### `region`

The AWS region to use, which defaults to the value of the `AWS_REGION` environment variable when present, or `us-east-1`.

Example: `"region": "us-west-1"`

### Runtime configuration options

#### `allowedHostnames`

An array of hostnames which may be updated by the Lambda.
You almost certainly want to set this to _something_, as leaving it wide open is likely a security hole unless you expect dynamic DNS to manage every hostname in your domain.

Example: `"allowedHostnames": ["home","barn"]`

#### `allowedIPMasks`

An array of CIDR-formatted IPv4 address masks, such as `12.34.0.0/16`.

When present, the Lambda will validate that the incoming IP address is among the expected masks.
If you have a relatively stable ISP, you should probably set this.

Example: `"allowedIPMasks": ["12.34.0.0/16"]`

#### `changeCommentTemplate`

Route53 record updates may include an optional text Comment.
You may use `${ip}`, `${hostname}`, and `${username}` placeholders, all optional, which will be interpolated with their runtime values.

Example: `"changeCommentTemplate": "Update ${hostname} to ${ip} by ${username}"`

#### `clientUsername`

If provided, the client *must* send exactly this value in the query string parameter defined by [`usernameParam`](#usernameparam).
Otherwise, that parameter value is ignored (except for comment interpolation, above).

Example: `"clientUsername": "home-router"`

#### `hostnameOverride`

If provided, this value is used for the Route53 hostname update, regardless of any value sent by the client in the [`hostnameParam`](#hostnameparam) query string parameter.
You probably want this if you have exactly one hostname you want the Lambda to manage.

Example: `"hostnameOverride": "home"`

#### `hostnameParam`

The name of the query string parameter which the client will use to send the hostname which should be updated.
If not supplied, this defaults to `hostname`.

Example: `"hostnameParam": "name"`

#### `ipMustMatchRemoteAddr`

When `true` (or not present), the Lambda performs an additional check: the IP address supplied via the query string parameters must match the IP address AWS detects as the remote address of the caller.
If this check fails, the update is rejected.

If this value is `false`, clients can update host address to any acceptable IP.

This can be useful to disable if you want clients to be able to register local/private IP addresses.

#### `ipParam`

The name of the query string parameter clients will use to pass the updated IP address.
Defaults to `ip` if not present.

Can be valuable when your router requires a specific query string parameter name for the IP address value.

See also [`useRemoteAddrWhenNoIP`](#useremoteaddrwhennoip).

Example: `"ipParam": "addr"`

#### `secretParam`

The name of the query string parameter clients will use to pass the API Key / shared secret which authenticates the update.
Defaults to `secret` if not present.

Sadly, I've yet to see any routers support actual _signing_ of requests, so this is just a static shared secret.

Example: `"secretParam": "apiKey"`

#### `ttlSeconds`

The Time-to-Live value (in seconds) set on the updated Route53 `A` record for the hostname.
Defaults to 900 seconds, which is 15 minutes.

Short times can ensure others see timely updates when your IP address changes, but may cause additional overhead due to constant rechecks.

Example: `"ttlSeconds": 3600`

#### `useRemoteAddrWhenNoIP`

If `true`, and the client does not send an IP address in the [`ipParam`](#ipparam) query string parameter, the IP address detected by AWS will be used, instead.

Can be useful when your client can't reliably detect its own public IP address, such as when behind multiple layers of NAT.

#### `usernameParam`

The name of the query string parameter the client will use to communicate the username associated with the update.
Defaults to `username`.

As the username is not used for anything when [`clientUsername`](#clientusername) is not set, and [`clientSecret`](#clientsecret) is already far more random than a username is likely to be, you probably don't want or need to set this unless you have multiple clients performing updates, and you want to see them in the logs.

Example: `"usernameParam": "u"`.

## License

All work in this repo is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license:

https://creativecommons.org/licenses/by-nc-sa/4.0/
