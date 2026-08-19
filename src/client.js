import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export function createClient(provider, baseurl, apikey) {
    var p, b, a;

    if (provider && typeof provider === "object") {
        if (!provider.provider) {
            throw new Error(`
Object must be passed in this format:

{
    provider: "provider-name",
    baseurl: "provider-base-url",
    apikey: "provider-api-key" // optional when the provider SDK env var is set
}
`);
        }

        p = provider.provider;
        b = provider.baseurl || provider.baseUrl || provider.baseURL;
        a = provider.apikey || provider.apiKey || provider.api_key;
    } else {
        p = provider;
        b = baseurl;
        a = apikey;
    }

    if (!p || typeof p !== "string" || !p.trim()) {
        throw new Error(
            "Provider name is required and must be a non-empty string."
        );
    }

    if ((!b || typeof b !== "string" || !b.trim()) && String(p).trim().toLowerCase() !== "anthropic") {
        throw new Error(
            "Base URL is required and must be a non-empty string."
        );
    }

    p = p.trim().toLowerCase() === "anthropic" ? "anthropic" : "openai-compatible";
    b = b ? b.trim() : "https://api.anthropic.com";
    a = (typeof a === "string" && a.trim()) ? a.trim() : undefined;

    var client;

    if (p === "anthropic") {
        client = new Anthropic({
            apiKey: a,
            baseURL: b
        });
    } else {
        client = new OpenAI({
            apiKey: a,
            baseURL: b
        });
    }

    return {
        provider: p,
        baseurl: b,
        apikey: a,
        client: client
    };
}
