import { proxyToApi } from "../../../lib/apiProxy";

export async function GET(request: Request) {
  return proxyToApi(request, "/health");
}
