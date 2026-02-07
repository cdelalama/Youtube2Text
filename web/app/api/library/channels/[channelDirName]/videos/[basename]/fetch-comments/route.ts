import { proxyToApi } from "../../../../../../../../lib/apiProxy";

export async function POST(
  request: Request,
  ctx: { params: { channelDirName: string; basename: string } }
) {
  const { channelDirName, basename } = ctx.params;
  return proxyToApi(
    request,
    `/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(basename)}/fetch-comments`
  );
}
