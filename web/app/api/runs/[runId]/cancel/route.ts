import { proxyToApi } from "../../../../../lib/apiProxy";

export async function POST(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  return proxyToApi(request, `/runs/${encodeURIComponent(runId)}/cancel`);
}
