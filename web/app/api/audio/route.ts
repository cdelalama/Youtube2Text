import { proxyToApi } from "../../../lib/apiProxy";

export async function POST(request: Request) {
  return proxyToApi(request, "/audio");
}
