/**
 * Wraps Claude-generated HTML report body in a full email-safe HTML document.
 */
export function wrapReportHtml(bodyHtml, date) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Outreach Report — ${date}</title>
</head>
<body style="margin:0;padding:20px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  ${bodyHtml}
</body>
</html>`;
}
