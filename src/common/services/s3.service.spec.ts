import "reflect-metadata";
import { S3Service } from "./s3.service";

/**
 * Regression tests for S3 key extraction. After the CloudFront migration,
 * stored media URLs are CDN URLs (https://<cdnDomain>/<key>), not S3 URLs.
 * The key must still be derived correctly so DeleteObject targets the right
 * object (an empty key caused production 403 AccessDenied errors).
 */
function makeService(cfg: Record<string, any> = {}): any {
  const configService = { get: (k: string) => cfg[k] };
  return new S3Service(configService as any);
}

describe("S3Service.extractKeyFromUrl", () => {
  const svc = makeService({
    AWS_REGION: "ap-south-1",
    AWS_S3_BUCKET_NAME: "prajaakeeya",
    AWS_CLOUDFRONT_DOMAIN: "cdn.prajaakeeya.org",
  });
  const extract = (u: string): string => (svc as any).extractKeyFromUrl(u);

  it("extracts the key from a CloudFront / CDN URL", () => {
    expect(extract("https://cdn.prajaakeeya.org/reports/123-file.pdf")).toBe(
      "reports/123-file.pdf",
    );
  });

  it("extracts the key from a default cloudfront.net URL", () => {
    expect(
      extract("https://d111abcdef8.cloudfront.net/profile/9-pic.jpg"),
    ).toBe("profile/9-pic.jpg");
  });

  it("extracts the key from an S3 virtual-hosted URL", () => {
    expect(
      extract(
        "https://prajaakeeya.s3.ap-south-1.amazonaws.com/profile/9-pic.jpg",
      ),
    ).toBe("profile/9-pic.jpg");
  });

  it("decodes URL-encoded characters in the key", () => {
    expect(extract("https://cdn.prajaakeeya.org/docs/a%20b.pdf")).toBe(
      "docs/a b.pdf",
    );
  });

  it("returns a bare key unchanged", () => {
    expect(extract("reports/123-file.pdf")).toBe("reports/123-file.pdf");
  });

  it("returns an empty string for empty input (no accidental bucket-root delete)", () => {
    expect(extract("")).toBe("");
  });
});
