import type { SimulationScenario } from "../engine/scenario-runner.js";

export const deployIntegrityStrictScenario: SimulationScenario = {
  id: "deploy_integrity_strict",
  dispatchMode: "strict",
  async run(ctx) {
    const coreAddress = ctx.deployCtx.artifacts.coreAddress;
    const coreClassHash = ctx.deployCtx.artifacts.coreClassHash;

    const classHashAt = await ctx.rpc.requireResult<string>(
      "starknet_getClassHashAt",
      ["latest", coreAddress],
      "read",
    );

    ctx.checks.push({
      id: "deploy_integrity.class_hash_at",
      status:
        classHashAt.toLowerCase() === coreClassHash.toLowerCase()
          ? "pass"
          : "fail",
      details: "Class hash at deployed core address should match declared class hash",
      evidence: {
        expected: coreClassHash,
        actual: classHashAt,
      },
    });

    const classAt = await ctx.rpc.rawCall(
      "starknet_getClassAt",
      ["latest", coreAddress],
      "read",
    );

    const classByHash = await ctx.rpc.rawCall(
      "starknet_getClass",
      ["latest", coreClassHash],
      "read",
    );

    ctx.checks.push({
      id: "deploy_integrity.class_queries",
      status:
        "result" in classAt && "result" in classByHash ? "pass" : "fail",
      details: "Core class should be queryable by address and by class hash",
      evidence: {
        classAtOk: "result" in classAt,
        classByHashOk: "result" in classByHash,
      },
    });

    const events = await ctx.rpc.rawCall(
      "starknet_getEvents",
      [
        {
          from_block: "latest",
          to_block: "latest",
          address: coreAddress,
          keys: [],
          chunk_size: 64,
        },
      ],
      "read",
    );

    ctx.checks.push({
      id: "deploy_integrity.events_endpoint",
      status: "result" in events ? "pass" : "fail",
      details: "Events endpoint should respond for core contract",
      evidence:
        "result" in events
          ? { eventsCount: (events.result as any)?.events?.length ?? 0 }
          : { error: events.error },
    });
  },
};
