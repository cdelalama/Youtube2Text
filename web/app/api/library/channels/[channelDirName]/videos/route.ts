import { proxyToApi } from "../../../../../../lib/apiProxy";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ channelDirName: string }> }
) {
  const { channelDirName } = await ctx.params;
  return proxyToApi(
    request,
    `/library/channels/${encodeURIComponent(channelDirName)}/videos`
  );
}
