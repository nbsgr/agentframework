import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export function createClient(provider, baseurl, apikey) {
    var p, b, a;

    // Object argument
    if (provider && typeof provider === "object") {

        if (
            !provider.provider ||
            !provider.baseurl ||
            !provider.apikey
        ) {
            throw new Error(`
Object must be passed in this format:

{
    provider: "provider-name",
    baseurl: "provider-base-url",
    apikey: "provider-api-key"
}
`);
        }

        p = provider.provider;
        b = provider.baseurl;
        a = provider.apikey;
    }

    // Direct arguments
    else {
        p = provider;
        b = baseurl;
        a = apikey;
    }

    // Provider validation
    if (!p || typeof p !== "string" || !p.trim()) {
        throw new Error(
            "Provider name is required and must be a non-empty string."
        );
    }

    // Base URL validation
    if (!b || typeof b !== "string" || !b.trim()) {
        throw new Error(
            "Base URL is required and must be a non-empty string."
        );
    }

    // API key validation
    if (!a || typeof a !== "string" || !a.trim()) {
        throw new Error(
            "API key is required and must be a non-empty string."
        );
    }

    p = p.trim();
    b = b.trim();
    a = a.trim();

    var client;

    if (p.toLowerCase() === "anthropic") {
        client = new Anthropic({
            apiKey: a
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