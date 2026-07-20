// お知らせバナー左端のマスコットアイコン。
// TODO: 正式なマスコット画像(青いαキャラ)が用意でき次第、この定数を
// その画像の data-URI(base64)に差し替える。差し替えはこの1定数のみでよい。
// ホスト側からは <announce-banner icon-src="..."> 属性でも上書きできる。

// 暫定プレースホルダー: 青い円に「α」を描いた小さな SVG。
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#1565c0"/><text x="16" y="22" font-size="17" font-family="serif" fill="#ffffff" text-anchor="middle">α</text></svg>`

export const ANNOUNCE_ICON_DATA_URI: string = `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER_SVG)}`
