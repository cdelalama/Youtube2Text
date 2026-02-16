import { proxyToApi } from "../../../../../lib/apiProxy";

export async function GET(
  request: Request,
  ctx: { params: { channelDirName: string } }
) {
  return proxyToApi(
    request,
    `/library/channels/${encodeURIComponent(ctx.params.channelDirName)}`
  );
}

export async function DELETE(
  request: Request,
  ctx: { params: { channelDirName: string } }
) {
  return proxyToApi(
    request,
    `/library/channels/${encodeURIComponent(ctx.params.channelDirName)}`
  );
}

