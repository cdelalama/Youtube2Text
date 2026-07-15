import { proxyToApi } from "../../../../../../../lib/apiProxy";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ channelDirName: string; basename: string }> }
) {
  const { channelDirName, basename } = await ctx.params;
  return proxyToApi(
    request,
    `/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(basename)}`
  );
}
