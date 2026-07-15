import { proxyToApi } from "../../../../lib/apiProxy";

export async function GET(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  return proxyToApi(request, `/runs/${encodeURIComponent(runId)}`);
}
