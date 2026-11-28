export const NextResponse = Response;
export class NextRequest extends Request {
  get nextUrl() { return new URL(this.url); }
}
