import console from "node:console";

import type { AwsConfig } from "./aws-config.js";

export type DeployableType = new (awsConfig: AwsConfig, ...rest: any) => Deployable;
export type DeployableTypeOf<T> = new (awsConfig: AwsConfig, ...rest: any) => T;

export abstract class Deployable {
	private static readonly instances = new Set<Deployable>();

	public abstract readonly dependsOn: DeployableType[];

	protected constructor(public readonly awsConfig: AwsConfig) {
		Deployable.instances.add(this);
	}

	public abstract apply(): Promise<void>;

	protected assertDefined<T>(value: T, name: string): asserts value is NonNullable<T> {
		if (value == null) {
			throw new Error(`${ this.typeName }: missing ${ name }`);
		}
	}

	protected logInfo(...args: unknown[]): void {
		console.log(...args);
	}

	public abstract get needApply(): boolean;

	public abstract plan(): Promise<void>;

	protected requireType<T extends Deployable>(type: DeployableTypeOf<T>): T {
		for (const instance of Deployable.instances) {
			if (instance instanceof type) {
				return instance;
			}
		}
		throw new Error(`Could not find instance of type: ${ type.name }`);
	}

	public get typeName(): string {
		return this.constructor.name.replace(/Deployable$/, "");
	}
}

export const planAll = async (deployables: Deployable[]): Promise<Deployable[]> => {
	const needs = new Map<Deployable, Set<DeployableType>>(deployables.map((d) => [ d, new Set<DeployableType>(d.dependsOn) ]));
	const done: Deployable[] = [];
	while (needs.size > 0) {
		let toPlan: Deployable | undefined;
		for (const [ deployable, dependsOn ] of needs) {
			for (const dependency of dependsOn) {
				const met = done.find((d) => d instanceof dependency);
				if (met != null) {
					dependsOn.delete(dependency);
				}
			}
			if (dependsOn.size === 0) {
				toPlan = deployable;
				break;
			}
		}
		if (toPlan == null) {
			throw new Error(`Cannot satisfy all Deployable dependencies: ${ Array.from(needs.entries()).map(([ d, t ]) => `${ d.typeName }[${ Array.from(t).map((c) => c.name).join(",") }]`).join(" ") }`);
		}
		needs.delete(toPlan);
		console.log(`Plan: ${toPlan.typeName}`);
		await toPlan.plan();
		done.push(toPlan);
	}
	return done;
};
