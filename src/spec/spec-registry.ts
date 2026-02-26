import fs from "node:fs";
import {
  compileMethodParamsValidator,
  compileMethodResultValidator,
  createAjv,
  registerOpenRpcReferenceSchemas,
  type OpenRpcMethodDef,
} from "./schema-compiler.js";
import { ensureSpecCached, resolveCachedSpecFilePath } from "./spec-cache.js";

interface OpenRpcDocument {
  methods?: Array<{
    name: string;
    params?: Array<{ name: string; required?: boolean; schema?: unknown }>;
    result?: { schema?: unknown };
  }>;
  components?: Record<string, unknown>;
}

type MethodSource = "read" | "write" | "trace" | "ws";

interface MethodEntry extends OpenRpcMethodDef {
  source: MethodSource;
}

export interface OpenRpcBundle {
  readDoc: OpenRpcDocument;
  writeDoc: OpenRpcDocument;
  traceDoc: OpenRpcDocument;
  wsDoc: OpenRpcDocument;
}

export interface SpecRegistry {
  listOfficialMethods(): string[];
  hasMethod(method: string): boolean;
  getMethodSource(method: string): MethodSource;
  validateParams(method: string, params: unknown): { ok: boolean; errors?: unknown };
  validateResult(method: string, result: unknown): { ok: boolean; errors?: unknown };
}

function loadOpenRpcDocument(
  specTag: string,
  fileName: string,
  cacheDirOverride?: string,
): OpenRpcDocument {
  const filePath = resolveCachedSpecFilePath(specTag, fileName, cacheDirOverride);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing cached Starknet spec file ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as OpenRpcDocument;
}

export async function loadOpenRpcBundle(options: {
  specTag: string;
  cacheDirOverride?: string;
}): Promise<OpenRpcBundle> {
  const fileNames = [
    "starknet_api_openrpc.json",
    "starknet_write_api.json",
    "starknet_trace_api_openrpc.json",
    "starknet_ws_api.json",
  ];

  await ensureSpecCached({
    specTag: options.specTag,
    fileNames,
    cacheDirOverride: options.cacheDirOverride,
  });

  return {
    readDoc: loadOpenRpcDocument(options.specTag, fileNames[0], options.cacheDirOverride),
    writeDoc: loadOpenRpcDocument(options.specTag, fileNames[1], options.cacheDirOverride),
    traceDoc: loadOpenRpcDocument(options.specTag, fileNames[2], options.cacheDirOverride),
    wsDoc: loadOpenRpcDocument(options.specTag, fileNames[3], options.cacheDirOverride),
  };
}

export class OpenRpcSpecRegistry implements SpecRegistry {
  private readonly methods = new Map<string, MethodEntry>();

  private readonly paramsValidatorCache = new Map<string, (x: unknown) => boolean>();

  private readonly resultValidatorCache = new Map<string, (x: unknown) => boolean>();

  private readonly ajv = createAjv();

  constructor(private readonly bundle: OpenRpcBundle) {
    registerOpenRpcReferenceSchemas(this.ajv, bundle);
    this.addMethods(bundle.readDoc, "read");
    this.addMethods(bundle.writeDoc, "write");
    this.addMethods(bundle.traceDoc, "trace");
  }

  private addMethods(doc: OpenRpcDocument, source: MethodSource): void {
    for (const method of doc.methods || []) {
      if (!method.name) {
        continue;
      }

      this.methods.set(method.name, {
        name: method.name,
        params: method.params,
        result: method.result,
        components: doc.components,
        source,
      });
    }
  }

  listOfficialMethods(): string[] {
    return [...this.methods.keys()].sort();
  }

  hasMethod(method: string): boolean {
    return this.methods.has(method);
  }

  getMethodSource(method: string): MethodSource {
    return this.getMethodOrThrow(method).source;
  }

  validateParams(method: string, params: unknown): { ok: boolean; errors?: unknown } {
    const validator = this.getMethodParamsValidator(method);
    return {
      ok: Boolean(validator(params)),
      errors: (validator as { errors?: unknown }).errors,
    };
  }

  validateResult(method: string, result: unknown): { ok: boolean; errors?: unknown } {
    const validator = this.getMethodResultValidator(method);
    const ok = validator({ result });

    return {
      ok: Boolean(ok),
      errors: (validator as { errors?: unknown }).errors,
    };
  }

  private getMethodParamsValidator(method: string): (x: unknown) => boolean {
    const cached = this.paramsValidatorCache.get(method);
    if (cached) {
      return cached;
    }

    const definition = this.getMethodOrThrow(method);
    const validator = compileMethodParamsValidator(this.ajv, definition);
    this.paramsValidatorCache.set(method, validator);
    return validator;
  }

  private getMethodResultValidator(method: string): (x: unknown) => boolean {
    const cached = this.resultValidatorCache.get(method);
    if (cached) {
      return cached;
    }

    const definition = this.getMethodOrThrow(method);
    const validator = compileMethodResultValidator(this.ajv, definition);
    this.resultValidatorCache.set(method, validator);
    return validator;
  }

  private getMethodOrThrow(method: string): MethodEntry {
    const found = this.methods.get(method);
    if (!found) {
      throw new Error(`Method ${method} not found in official Starknet OpenRPC docs`);
    }
    return found;
  }
}

export async function createSpecRegistry(options?: {
  specTag?: string;
  cacheDirOverride?: string;
}): Promise<OpenRpcSpecRegistry> {
  const specTag = options?.specTag ?? "v0.10.0";
  const bundle = await loadOpenRpcBundle({ specTag, cacheDirOverride: options?.cacheDirOverride });
  return new OpenRpcSpecRegistry(bundle);
}
