// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Encoding Utilities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(str: string): string {
    let result = ''
    let i = 0
    while (i < str.length) {
        const a = str.charCodeAt(i++)
        const b = i < str.length ? str.charCodeAt(i++) : 0
        const c = i < str.length ? str.charCodeAt(i++) : 0
        const triplet = (a << 16) | (b << 8) | c
        result += B64[(triplet >> 18) & 0x3f]
        result += B64[(triplet >> 12) & 0x3f]
        result += i - 2 < str.length ? B64[(triplet >> 6) & 0x3f] : '='
        result += i - 1 < str.length ? B64[triplet & 0x3f] : '='
    }
    return result
}

export function decodeBody(body: unknown): string {
    if (typeof body === 'string') return body
    const bytes = new Uint8Array(body as ArrayBuffer)
    let str = ''
    for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i])
    }
    return str
}