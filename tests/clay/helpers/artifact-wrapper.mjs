// MODEL of the page-wrapper step the Artifact tool applies when it publishes a page file. The real step runs inside the
// publishing service and is not in this repository, so this is a reconstruction from observed behaviour, calibrated in
// tests/clay/artifact-wrapper.test.mjs against ONE explicitly demonstrated publish event (see that file). It is not the platform's code.
//
// Observed contract (artifact-design / artifact-capabilities guidance and that one publish event):
//  * a published page is served inside the tool's own skeleton: doctype, charset + viewport metas and ONE <style> holding a
//    small fixed reset, then the page content, then </body></html>;
//  * if the file already begins with that skeleton, the tool recognises it and REPLACES it rather than nesting it;
//    anything a file had added inside the skeleton's <style> (after the reset) is not carried over;
//  * everything after the skeleton's "</style></head><body>" (the page's own <title>, <style>, body and scripts) is kept as is.
export const HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">';
export const RESET = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';
export const SKELETON = HEAD + '<style>' + RESET + '</style></head><body>';
const CLOSE = '</style></head><body>';

export function wrapAsArtifact(src) {
  const open = HEAD + '<style>' + RESET;
  let page = src;
  if (src.startsWith(open)) {
    const at = src.indexOf(CLOSE, open.length);
    if (at < 0) throw new Error('skeleton recognised but its closing "</style></head><body>" is missing');
    page = src.slice(at + CLOSE.length); // whatever sat between the reset and the close is dropped
  }
  return SKELETON + page + (/<\/body>\s*<\/html>\s*$/.test(page) ? '' : '</body></html>');
}

// Splits wrapped output into the skeleton and the page-owned part; the page-owned stylesheet is every <style> after the skeleton.
export function parts(wrapped) {
  if (!wrapped.startsWith(SKELETON)) throw new Error('output does not start with the canonical skeleton');
  const page = wrapped.slice(SKELETON.length);
  const styles = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  return { skeleton: SKELETON, page, pageCss: styles.join('\n') };
}
