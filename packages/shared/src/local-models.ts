export interface LocalModel {
  id: string;
  name: string;
  model: string;
}

export const LOCAL_BACKEND_PREFIX = "local-";

export function parseLocalModels(spec: string | undefined): LocalModel[] {
  const out: LocalModel[] = [];
  for (const item of (spec ?? "").split(",")) {
    const [id, name, ...rest] = item.split("|").map((x) => x.trim());
    const model = rest.join("|");
    if (!id || !name || !model || !/^[\w.-]+$/.test(id)) continue;
    out.push({ id: LOCAL_BACKEND_PREFIX + id, name, model });
  }
  return out;
}

export function isLocalBackend(id: string | undefined): boolean {
  return !!id && id.startsWith(LOCAL_BACKEND_PREFIX);
}
