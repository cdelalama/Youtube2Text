import { proxyToApi } from "../../../../../../../../lib/apiProxy";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ channelDirName: string; basename: string; kind: string }> }
) {
  const { channelDirName, basename, kind } = await ctx.params;
  return proxyToApi(
    request,
    `/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(basename)}/${encodeURIComponent(kind)}`
  );
}
