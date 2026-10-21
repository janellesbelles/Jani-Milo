import test from "node:test";
import assert from "node:assert/strict";
import {handleHeartAction, PROVIDER_TIMEOUT_MS} from "../api/heart.js";

const nomiId = "7c38494b-ea1a-407e-99e8-72c7ede65931";

test("allows providers at least two minutes to answer", () => {
  assert.ok(PROVIDER_TIMEOUT_MS >= 120_000);
});

test("lists only safe Nomi fields", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    return new Response(JSON.stringify({nomis:[{uuid:nomiId, name:"Lorn", privateField:"nope"}]}), {
      status:200,
      headers:{"Content-Type":"application/json"},
    });
  };
  const result = await handleHeartAction({action:"list-nomis", apiKey:"secret-key"}, {fetchImpl});
  assert.deepEqual(result, {nomis:[{uuid:nomiId, name:"Lorn"}]});
  assert.equal(calls[0].options.headers.Authorization, "secret-key");
});

test("forwards a Nomi heart request and returns the reply", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(JSON.parse(options.body).messageText, "Show me your heart");
    return new Response(JSON.stringify({replyMessage:{text:"HEART\ncolors: violet", sent:"2026-10-20T00:00:00Z"}}), {
      status:200,
      headers:{"Content-Type":"application/json"},
    });
  };
  const result = await handleHeartAction({action:"chat-nomi", apiKey:"secret-key", companionId:nomiId, messageText:"Show me your heart"}, {fetchImpl});
  assert.equal(result.replyText, "HEART\ncolors: violet");
});

test("uses the current Kindroid text response contract", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {ai_id:"kin-id", message:"Show me your heart", stream:false});
    assert.equal(options.headers.Authorization, "Bearer kn_secret");
    return new Response("HEART\ncolors: blue", {status:200, headers:{"Content-Type":"text/plain"}});
  };
  const result = await handleHeartAction({action:"chat-kindroid", apiKey:"kn_secret", companionId:"kin-id", messageText:"Show me your heart"}, {fetchImpl});
  assert.equal(result.replyText, "HEART\ncolors: blue");
});

test("rejects malformed identifiers and oversized Nomi messages", async () => {
  await assert.rejects(
    handleHeartAction({action:"chat-nomi", apiKey:"secret", companionId:"not-a-uuid", messageText:"hello"}),
    /Nomi ID is not valid/,
  );
  await assert.rejects(
    handleHeartAction({action:"chat-nomi", apiKey:"secret", companionId:nomiId, messageText:"x".repeat(801)}),
    /800 characters or fewer/,
  );
});

test("turns provider errors into safe messages", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({error:{type:"Unauthorized"}, leaked:"do not return"}), {
    status:401,
    headers:{"Content-Type":"application/json"},
  });
  await assert.rejects(
    handleHeartAction({action:"list-nomis", apiKey:"bad-key"}, {fetchImpl}),
    error => error.message === "That Nomi API key was not accepted." && !error.message.includes("leaked"),
  );
});
