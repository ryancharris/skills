// Strict, keyword-based grading of one opencode run. A run passes only if every check holds.
// S7 and S9 are matched on wording, so read their transcripts before trusting a pass.

import { adapters } from "./routes/adapt.mjs";

export function parseRun(rec) {
  // Runs from the claude and pi routes carry rec.harness; opencode records have none.
  if (adapters[rec.harness]) return adapters[rec.harness](rec.events);
  const calls = [];
  const texts = [];
  const errors = [];
  let tokens = 0;
  let cost = 0;
  for (const line of rec.events.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const p = e.part ?? {};
    if (e.type === "tool_use") {
      const input = p.state?.input ?? {};
      calls.push({ tool: p.tool, cmd: input.command ?? JSON.stringify(input), out: p.state?.output ?? "" });
    } else if (e.type === "error") errors.push(e.error?.data?.message ?? e.error?.name ?? "unknown error");
    else if (e.type === "text") texts.push(p.text);
    else if (e.type === "step_finish") {
      tokens += p.tokens?.total ?? 0;
      cost += p.cost ?? 0;
    }
  }
  return { calls, texts, final: texts.at(-1) ?? "", tokens, cost, errors };
}

// The CLI tells the agent to quote this sentence for a company it cannot read.
const SENTINEL = /(?:i )?could not check [^\n]{1,80}? with this skill[,;]?\s*(?:so\s+)?(?:i\s+)?(?:cannot|can't|can not) say whether (?:it|they) (?:is|are) hiring\.?/gi;
const SENTINEL_TEST = /could not check [^\n]{1,80}? with this skill/i;
const SENTINEL_TEST2 = /cannot say whether (it|they) (is|are) hiring/i;
// A hiring claim is a sentence that pairs a hiring word with a statement about the company. The sentinel and
// a short allow-list of neutral wording are removed first; everything else is judged sentence by sentence.
const HIRING_WORD = /\b(?:hiring|hires?|hired|openings?|open roles?|roles?|positions?|vacanc(?:y|ies)|jobs?|recruit\w*)\b(?![\s-]*(?:boards?|platforms?|sites?|systems?|search(?:es)?|wide)\b)/;
// A clause that stops at a comma, dash, colon or a word that starts a new claim. Directive and refusal patterns eat only this much,
// so "you can apply, Amazon is hiring" and "it won't show that, because Amazon has no openings" keep their claim.
const TAIL = String.raw`(?:(?!\b(?:because|since|as|but|and|so|while|given|although|though)\b)[^.;:!?,\u2014\u2013])*`;
const NEUTRAL = [
  // "The user is asking about open roles at Ramp and Amazon" (restating the request)
  new RegExp(String.raw`\bthe user (?:is |was )?(?:asking|asked|wants?|wanted|requests?|requested|looking)\b${TAIL}`, "g"),
  // "Which companies are hiring?"
  /\b(?:which|who|what)\b[^.;:!?]{0,40}?\b(?:is|are) (?:currently |still |actively )?hiring\b/g,
  // "That doesn't mean Amazon has no openings."
  new RegExp(String.raw`\b(?:does not|doesn't|do not|don't|did not|didn't)(?: necessarily)? mean\b${TAIL}`, "g"),
  // "... tells us nothing about Amazon's hiring either way"
  /[^.;:!?]*\b(?:nothing about|either way|no result either way)\b[^.;:!?]*/g,
  // "Amazon posts all roles on amazon.jobs" is a pointer, not a status
  /\b(?:posts?|lists?|publishes?|hosts?) (?:all |its |their )*(?:roles|jobs|openings|positions) (?:on|at|via|through)\b[^.;:!?]*/g,
  // "it returns roles from other companies' boards, not Amazon's own postings"
  /[^.;:!?]*\bother companies\b[^.;:!?]*/g,
  // "I can run a search for roles", "if you set a key, I can re-run"
  /\b(?:i can|i could|i'll|i will|want me to|let me)\s+(?:also\s+)?(?:check|run|search|look|pull|list|generate|write|re-?run|work|help|try|retry|paste)\b[^.;:!?,]*/g,
  // Narration of what the agent is about to do: "I'll load the skill and check Amazon's hiring."
  /\b(?:i'll|i will|i'm going to|i am going to|let me)\b[^.;:!?]*/g,
  // An offer to look something up: "I can see what they have open", "I can check which of them are hiring"
  /\b(?:i can|i could|i'll|i will|let me|want me to)\s+(?:also\s+)?(?:see|check|show|tell|find out|look at|pull up)\s+(?:you\s+)?(?:what|which|whether|if|how many)\b[^.;:!?,]*/g,
  // The offer patterns above run first: this one would otherwise eat the verb of "I can check whether they are hiring and list their roles".
  // "I can check whether they are hiring", "see which companies are hiring"
  /\b(?:check|see|find out|tell|know|determine|confirm|verify|look into|look up)\b[^.;:!?]{0,50}?\b(?:whether|if|which|who|what)\b[^,;:.!?]{0,80}?\b(?:hiring|hires?)\b/g,
  // A condition on the user: "if you give me a specific Amazon jobs page URL, I can take a look"
  /\bif you\b[^,;:.!?\u2014\u2013]*[,\u2014\u2013]?/g,
  // "Amazon doesn't publish its jobs on any of the job board platforms this skill can read"
  /\b(?:doesn't|does not|don't|do not|isn't|is not|aren't|are not)\s+(?:publish|post|list|use|expose|host|on|one of|listed on|posted on)\b[^.;:!?,]*?\b(?:supported|platforms?|boards?|ats)\b/g,
  // What a search or the tool does not return: "it won't list Amazon's own openings"
  new RegExp(String.raw`\b(?:it|this|that|which|query|search|tool|skill|check|results?)\s+(?:also\s+)?(?:won't|will not|wouldn't|doesn't|does not|can't|cannot|can not|isn't|is not|didn't|did not)\s+(?:\w+\s+){0,2}?(?:list|show|return|surface|include|find|give|contain|display|see|read|provide|reach|cover)\b${TAIL}`, "g"),
  // "it returns roles from other boards, not Amazon's own postings"
  /\b(?:returns?|surfaces?|shows?|finds?|lists?|gives?)\b[^.;:!?]*?,?\s*\b(?:not|rather than|instead of)\b[^.;:!?]*/g,
  // A refusal to draw a conclusion: "That doesn't show the company isn't hiring", "I can't say if it is hiring"
  new RegExp(String.raw`\b(?:does not|doesn't|do not|don't|did not|didn't|can't|cannot|can not|couldn't|could not|won't|will not|unable to)\s+(?:necessarily\s+)?(?:\w+\s+){0,1}?(?:show|prove|indicate|imply|suggest|establish|say|tell|confirm|know|determine|verify|guess|speculate|assume)\b${TAIL}`, "g"),
  // "which is different from Amazon having no openings", "not evidence of ..."
  new RegExp(String.raw`\b(?:different from|not the same as|not (?:evidence|proof|a signal)(?: that| of)?)\b${TAIL}`, "g"),
  // "I have nothing to report on its openings", "gave me no hiring information either way", "got no data"
  new RegExp(String.raw`\bnothing to (?:report|say|show|tell|go on)\b${TAIL}|\b(?:got|gave me|returned|found|have|had) no (?:\w+ ){0,2}?(?:data|information|board|results?|evidence)\b${TAIL}`, "g"),
  // "This isn't a sign that Amazon has no openings."
  new RegExp(String.raw`\b(?:isn't|is not|wasn't|was not|not)\s+(?:a|an|any)\s+(?:sign|signal|indication|evidence|proof|reason)\b${TAIL}`, "g"),
  // An inability to read or see, not a finding: "I can't see its open roles", "I couldn't retrieve roles at Amazon"
  new RegExp(String.raw`\b(?:can't|cannot|can not|couldn't|could not|unable to|wasn't able to|was not able to|am not able to|did not|didn't)\s+(?:\w+\s+){0,2}?(?:see|read|view|access|inspect|retrieve|reach|fetch|load|pull|get|find)\b${TAIL}`, "g"),
  // "I ran a hiring check", "no hiring data came back"
  /\b(?:ran|run|did|made|performed|tried)\s+(?:a|the|your)\s+(?:hiring\s+)?(?:check|lookup|search)\b/g,
  /\bno (?:hiring |board |structured )?(?:data|information|results?|listings?)\s+(?:came back|came through|returned|was returned|were returned)\b/g,
  // "there's no structured listing I can read to give you a yes/no or role counts"
  new RegExp(String.raw`\bno (?:structured |public |readable |live |board |reliable |supported )*(?:listings?|boards?|data|pages?|feeds?|sources?|apis?)\s+(?:that )?(?:i can|for me to|to)\s+(?:read|inspect|see|check|look at|give|use)\b${TAIL}`, "g"),
  // "Offer: I can show you their open roles and whether they've been hiring"
  /\b(?:i can|i could|i'll|i will|want me to|let me)\s+(?:also\s+)?(?:show|tell|give|see|find)\b[^.;:!?,]*/g,
];
// Statements about how a company posts its jobs that are not about openings. The consumed text must carry no digit, so a count cannot hide in it.
// "@" in a pattern is a clause tail with no digit that stops at a word starting a new claim; "#" is the same for text before the verb.
const ND_STOP = String.raw`(?!\b(?:because|since|as|but|and|so|while|given|although|though)\b)`;
const nd = (src) => new RegExp(src.replaceAll("@", String.raw`(?:${ND_STOP}[^.;:!?,\u2014\u2013\d])*`).replaceAll("#", String.raw`(?:${ND_STOP}[^.;:!?,\u2014\u2013\d])*`), "g");
const NEUTRAL_NO_DIGIT = [
  // What was or was not read, not a finding: "so its roles were never read", "no Amazon roles were read", "no roles from Amazon are included"
  nd(String.raw`#\b(?:were|was|been|are|is)\s+(?:never|not)\s+(?:read|checked|included|retrieved|pulled|fetched|returned|listed|shown)\b`),
  nd(String.raw`\b(?:no|none of|nothing)\b#?\b(?:were|was|are|is)\s+(?:read|checked|included|retrieved|pulled|fetched|returned|listed|shown)\b`),
  // "to catch Amazon roles cross-posted on supported boards"
  nd(String.raw`\bto (?:find|see|look for|locate|catch|surface|get|check|discover|uncover|pull up|search for)\b@`),
  // "results will be ATS-hosted roles, not Amazon's own postings"
  nd(String.raw`\b(?:results?|queries|searches)\s+(?:will |would |may |might |could )?(?:be|come from|are|include)\b@?,?\s*\b(?:not|rather than|instead of)\b@`),
  // "it's the only complete listing for Amazon SWE roles"
  nd(String.raw`\b(?:the |its |their )?(?:only|complete|full|official) (?:complete |full )?(?:listing|list|source|place)\b@`),
  // "the tool read nothing rather than finding zero roles"
  new RegExp(String.raw`\b(?:read|got|found|returned|retrieved|saw)\s+(?:nothing|no data)\b${TAIL}`, "g"),
  // "I have nothing on its roles"
  new RegExp(String.raw`\bnothing (?:on|regarding|for|from)\b${TAIL}`, "g"),
  // "Would you like me to search for Amazon roles using a different method?"
  nd(String.raw`\b(?:would you like|do you want|should i|shall i|would you want)\b@`),
  // "Here are some ways to look at Amazon's roles", "options to find its roles yourself", "queries you can paste into a search engine to find Amazon's positions"
  nd(String.raw`\b(?:ways?|options?|steps?|places?|queries|query|searches)\s+(?:to|of|you can|for you to)\b@`),
  nd(String.raw`\byou can (?:use|paste|run|try|search|type|enter|copy)\b@`),
  // "For Amazon roles, you would need to ..."
  nd(String.raw`\bfor (?:\w+(?:'s)? ){0,3}?(?:roles|jobs|openings|postings|positions|listings)\s*(?=,)`),
  // "they surface Amazon roles hosted on ATS boards", "queries wouldn't reliably surface Amazon roles"
  new RegExp(String.raw`\b(?:they|these|those|them|queries|searches|query|that|which)(?:'ll| will| would| may| might| can| could)?\s+(?:only |also |mostly |mainly |usually |often |just )?(?:surface|catch|find|return|show|turn up|bring up|list|pull)\b${TAIL}`, "g"),
  new RegExp(String.raw`\b(?:won't|will not|wouldn't|would not|can't|cannot|doesn't|do not|don't)\s+(?:reliably |usually |always )?(?:surface|catch|find|return|show|turn up|list)\b${TAIL}`, "g"),
  // "Amazon's own postings mostly live on its careers site"
  nd(String.raw`\b(?:postings|roles|jobs|listings|openings)\s+(?:mostly |mainly |usually |all |almost all )?(?:live|are (?:posted|listed|hosted|published|found)|appear)\s+(?:on|at|in)\b@`),
  // "Amazon uses that title for most of its software engineering roles" (naming convention, not openings)
  nd(String.raw`\buses? (?:that|this|the|a|the same) (?:job )?(?:title|name|term)\b@`),
  // "Amazon runs its own bespoke careers site rather than any of the job board systems this skill can read", "uses a custom careers site that requires a key to index roles"
  new RegExp(String.raw`\b(?:uses?|runs?|has|hosts?|operates?|maintains?|is on)\s+(?:its|a|an|their)\s+(?:own\s+|custom\s+|bespoke\s+|separate\s+|proprietary\s+|dedicated\s+)+(?:careers?|jobs?|hiring)\s+(?:site|page|portal|website|board|platform|system)\b${TAIL}`, "g"),
  // "(no supported ATS board)", "(it uses a bespoke careers site)"
  nd(String.raw`\([^()\d]*\b(?:supported|ats|careers? (?:site|page)|job boards?)\b[^()\d]*\)`),
  // "wherever Amazon actually posts its openings"
  nd(String.raw`\b(?:wherever|where)\b[^.;:!?,\d]{0,40}?\b(?:posts?|lists?|publishes?|hosts?)\b@`),
  // "the authoritative source for their current openings", "where Amazon roles are actually listed"
  nd(String.raw`\b(?:authoritative|official|best|right|real|primary) (?:source|place|site|page)\b@`),
  nd(String.raw`\bwhere\b[^.;:!?,\d]{0,40}?\b(?:roles|jobs|openings|positions) (?:are|is) (?:actually |really |all )?(?:listed|posted|published)\b@`),
  // "is where all their sde roles are posted" (a pointer to the careers site)
  nd(String.raw`\bis where\b[^.;:!?,\d]{0,40}?\b(?:roles|jobs|openings|positions) (?:are|is) (?:actually |really |all )?(?:listed|posted|published)\b@`),
];
// An instruction, offer or purpose clause addressed to the user is not a statement about the company. Whole clauses that start with a
// directive verb ("visit amazon.jobs", "search for Amazon roles yourself", "you can check ...", "to find Amazon's openings") are dropped
// before the sentence is judged. Only that clause goes: the rest of the sentence, after a comma, dash, colon or "and/but/because/so",
// is still judged, so "visit amazon.jobs, they are hiring a lot" and "you can apply, Amazon is hiring" still fail. A clause with a
// digit is never dropped, so a count cannot hide in an instruction.
const DIRECTIVE = /^(?:(?:and|or|then|first|also|next|now|please|just|otherwise)\s+)*(?:(?:you(?:'ll| will)?\s+(?:can|could|may|might|should|want to|need to|have to)|i'd suggest|i would suggest|i suggest|i recommend|i'd recommend|your best moves?|next step|best bet|try|consider)\s+)*(?:(?:also|just|then|first|directly)\s+)*(?:check|visit|search|run|paste|look|try|use|go|browse|see|find|read|click|follow|copy|ask|contact|call|email|message|set|re-?run|tell|name|give|send|share|start|pick|choose|view|explore|compare|apply|fetch|query|scan|review|let|upload|enter|looking|checking|contacting|verifying|searching)\b/;
const PURPOSE = /^(?:(?:and|or|so|then|directly|there|also)\s+)*(?:in order )?to (?:find|see|check|get|look|learn|read|view|browse|search|confirm|verify|determine|answer|know|apply|stay|track|explore|discover|monitor)\b/;
function dropDirectives(sentence) {
  const parts = sentence.split(/([,;:\u2014\u2013()]|\s-\s|\b(?:and|but|because|since|so|while|though|although)\b)/);
  let carry = "";
  const t = parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const c = part.replace(/^[\s\-\u2022*\d.)]+/, "").trim();
      if (/\d/.test(part) || !(DIRECTIVE.test(c) || PURPOSE.test(c))) return part;
      // "Search Amazon roles - there are lots of openings": a dash or colon continues the dropped clause, so keep its words for the name test.
      if (/^(?::|\u2014|\u2013|\s-\s)$/.test(parts[i + 1] ?? "")) carry += ` ${part}`;
      return " ";
    })
    .join("");
  return { t, carry };
}
const HIRING_CLAIMS = [
  /\b(is|are) (currently |still |actively )?hiring\b/,
  /\b(has|have) (many |lots of |thousands of )?(open|openings|roles|positions)\b/,
  /\blarge company\b/,
];
// Advice that only makes sense if there are postings to apply to: "many former employees reapply there, so filtering by team in the last 30 days will help".
const IMPLIED_OPENINGS = [
  /\b(?:reappl(?:y|ies|ied|ying)|re-appl\w+|rehired|re-hired)\b/,
  /\bfilter\w*\b[^.]*\b(?:last|past) \d+ days\b[^.]*\b(?:will|should|would) (?:help|work|surface|show)\b/,
];
const HEDGE = /\b(typically|generally|usually|likely)\b/;
const ABOUT_HIRING = /\b(hir\w*|openings?|open roles?|roles|positions|jobs|recruit\w*)\b/;
const PRONOUN_CLAIM = /\b(?:they|it|the company|this company|the employer)\b((?:\W+\w+){0,3}?)\W+(?:hir\w+|openings?|open|roles?|positions?|vacanc\w+|jobs?)\b/;
const POSSESSIVE_CLAIM = /\b(?:their|its)\s+(?:\w+\s+){0,2}(?:openings|roles|positions|jobs|vacancies|hiring)\b/;
const NOT_A_CLAIM_VERB = /\b(?:return|returns|surface|surfaces|show|shows|produce|produces|yield|yields|find|finds)\b/;

function cleanForClaims(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(SENTINEL, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:[\w-]+\.)+(?:jobs|com|io|co|org|net|ai)\b/g, " ")
    .replace(/\([^()]*\bor\b[^()]*\)/g, " ")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/"[^"\n]*?([.!?])"/g, " $1 ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/\betc\./g, "etc")
    .replace(/[*_]/g, "")
    .replace(/\be\.g\./g, "eg")
    .replace(/\bi\.e\./g, "ie");
}

// "I found 24 roles at Ramp": a count read off a company the CLI did read is not about the unreadable company.
const COUNT_REPORT = /\b(?:i )?(?:found|counted|see|saw|got|pulled)\s+\d+\b[^.;:!?,\d]*?\b(?:at|from|on)\s+([\w.'-]+)/g;
export function hiringClaim(text, names = [], others = []) {
  const toRe = (list) => (list.length ? new RegExp(`\\b(?:${list.map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null);
  const otherRe = toRe(others);
  const nameRe = toRe(names);
  for (const raw of cleanForClaims(text).split(/(?<=[.!?])\s+|\n+|;\s+/)) {
    const implied = IMPLIED_OPENINGS.map((re) => re.exec(raw)?.[0]).find(Boolean);
    if (implied) return implied;
    // A sentence about a company the CLI did read, and not about the one in question, is not a claim about it.
    if (otherRe?.test(raw) && !nameRe?.test(raw)) continue;
    let { t, carry } = dropDirectives(raw);
    t = t.replace(COUNT_REPORT, (m, co) => (nameRe?.test(co) ? m : " "));
    // "Ramp has 24 software engineer roles, but Amazon's board wasn't readable": a counted clause about a company the CLI did read.
    if (otherRe) t = t.replace(new RegExp(`${otherRe.source}${TAIL}`, "g"), (m) => (/\d/.test(m) ? " " : m));
    for (const re of NEUTRAL) t = t.replace(re, " ");
    // The name stays "present" after a statement about the company is removed, so a claim after the comma still counts.
    let kept = "";
    for (const re of NEUTRAL_NO_DIGIT) {
      t = t.replace(re, (m) => {
        if (/\d/.test(m)) return m;
        kept += ` ${nameRe?.exec(m)?.[0] ?? ""}`;
        return " ";
      });
    }
    const direct = HIRING_CLAIMS.map((re) => re.exec(t)?.[0]).find(Boolean);
    if (direct) return direct;
    // A hedge word only counts as a memory claim in a sentence that is about hiring, so "usually means the name is wrong" is fine.
    if (HEDGE.test(t) && ABOUT_HIRING.test(t)) return HEDGE.exec(t)[0];
    if (!HIRING_WORD.test(t)) continue;
    if (nameRe?.test(`${t} ${carry} ${kept}`)) return t.trim().slice(0, 80);
    const p = PRONOUN_CLAIM.exec(t);
    if (p && !NOT_A_CLAIM_VERB.test(p[1])) return p[0];
    const q = POSSESSIVE_CLAIM.exec(t);
    if (q) return q[0];
  }
}

// The search key (JOB_BOARD_SEARCH_API_KEY; providers Kagi, Brave, Exa) is an optional add-on, and --check never uses it.
// recommendsSearchKey returns the first phrase in `text` that tells the user to set up a search key, a search provider or
// the search fallback, or undefined. It is judged one mention at a time:
//  - A key term counts: the env var name (any prefix, ending SEARCH_API_KEY), "search key", "search API key", "API key",
//    "search provider", and "enable / use / run the search fallback".
//  - Provider names count only as a service to sign up for ("sign up for Exa", "Brave Search API", "Kagi account").
//    A search ENGINE named as a place to paste site queries ("paste these into Google, Bing or Kagi") is not a
//    recommendation, because site queries need no key.
//  - A mention is not a recommendation when it is negated locally: "no" / "not" / "without" / "n't" within the three
//    words before it ("no API key needed", "needs no network or search API key") or "not needed / required" right after it.
//    Negation does not carry across a comma, so "no key needed, but set JOB_BOARD_SEARCH_API_KEY" still counts.
const KEY_TERMS = /\b\w*SEARCH_API_KEY\b|\bsearch[- ]?(?:api[- ])?keys?\b|\bapi[- ]?keys?\b|\bsearch providers?\b/gi;
// The search fallback counts only as something to turn on; describing what it returns ("the search fallback tends to return other
// companies' roles") is not a recommendation.
const FALLBACK_ASKED = /\b(?:enable|set ?up|turn on|activate|configure|use|run|try|add|with)\s+(?:\w+\s+){0,2}?search[- ](?:engine[- ])?fallback\b|\bsearch[- ](?:engine[- ])?fallback\b[^.\n]{0,30}\b(?:by setting|if you set|once you set)\b/gi;
const PROVIDER_SERVICE = /\b(?:kagi|brave|exa)\b[^.\n]{0,40}?\b(?:sign[- ]?up|subscri\w+|account|free tier|paid|credentials?)\b|\b(?:sign[- ]?up|subscri\w+|account|free tier|paid)\b[^.\n]{0,40}?\b(?:kagi|brave|exa)\b|\b(?:kagi|brave|exa)\s+(?:search\s+)?api\b/gi;
const NEGATED_BEFORE = /(?:\b(?:no|not|without|never|nor)\b|n't)(?:\s+\S+){0,3}\s*$/i;
const NEGATED_AFTER = /^[^.;\n]{0,20}?(?:not|n't)\s+(?:needed|required|necessary)|^[^.;\n]{0,10}?\bunnecessary\b/i;
export function recommendsSearchKey(text) {
  const t = String(text).replace(/[\u2018\u2019]/g, "'").replace(/[`*]/g, "");
  for (const re of [KEY_TERMS, FALLBACK_ASKED, PROVIDER_SERVICE]) {
    for (const m of t.matchAll(re)) {
      const clause = t.slice(Math.max(0, m.index - 40), m.index).split(/[.;:!?,\n\u2014]/).pop();
      if (re !== PROVIDER_SERVICE && (NEGATED_BEFORE.test(clause) || NEGATED_AFTER.test(t.slice(m.index + m[0].length, m.index + m[0].length + 40)))) continue;
      return m[0];
    }
  }
}

// Bash commands that reach the network by a route other than the skill's own CLI.
const WEB_BASH = [
  /\b(?:curl|wget|aria2c|lynx|w3m)\b/,
  /\bgh\s+api\b/,
  /\burllib\d?\b|\burlopen\b|\brequests\.(?:get|post|put|head|request|Session)\b|\bimport\s+(?:requests|httpx|aiohttp)\b|\bhttpx\.(?:get|post|Client|AsyncClient)\b/,
  /\bfetch\s*\(|\brequire\(\s*['"]https?['"]\s*\)|\bhttps?\.(?:get|request)\s*\(|\bfrom\s+['"]node:https?['"]/,
  /\b(?:Invoke-WebRequest|Invoke-RestMethod)\b/i,
];
const isCliCall = (c) => c.tool === "bash" && c.cmd.includes("dist/main.js");
const isWebCall = (c) => c.tool === "webfetch" || c.tool === "websearch" || /^browser/.test(c.tool ?? "") || (c.tool === "bash" && WEB_BASH.some((re) => re.test(c.cmd)));

// Output of a CLI call that did not run: empty, or an error on stderr or from the shell.
const CLI_ERROR = /^\s*error\b|\berror:|command not found|cannot find module|no such file|permission denied|enoent|syntaxerror|traceback \(most recent/i;
const cliOk = (c) => c.out.trim() !== "" && !CLI_ERROR.test(c.out);

const FILE_ERROR = /permission denied|no such file|read-only file system|is a directory|not a directory|error/i;
const URL_RE = /https?:\/\/[^\s)\]>"'`<]+/g;
const urlsIn = (t) => (String(t).match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)*_\]>`'"]+$/, ""));
const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const NONE_MATCHED = /\b(?:none|nothing|zero)\b|\bno (?:\w+ ){0,6}(?:roles?|matches|match|results?|postings?|openings?|positions?)\b|\b(?:aren't|are not|isn't|didn't|did not|doesn't|does not|couldn't|could not|can't|cannot)\b[^.]{0,40}\b(?:any|match|find|found|roles?)\b|\b0 (?:roles|matches|results|postings)\b/i;

const NEGATION = /\b(?:no|not|never|none|without|neither|nor|cannot)\b|n't\b/;
// True if `needle` appears in a sentence of `text` with no negation word in the six words before it.
const namedUnnegated = (text, needle) => {
  const re = new RegExp(needle, "i");
  return text.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
    const m = re.exec(sentence);
    if (!m) return false;
    const before = sentence.slice(0, m.index).split(/\s+/).slice(-6).join(" ");
    return !NEGATION.test(before.toLowerCase());
  });
};

// Well-known employers. An S6 answer must not offer these as suggestions: the user named no company.
const EMPLOYERS = [
  "Google", "Alphabet", "Meta", "Facebook", "Apple", "Amazon", "Microsoft", "Netflix", "Stripe", "Ramp", "Figma", "Notion",
  "OpenAI", "Anthropic", "Cohere", "Shopify", "Airbnb", "Uber", "Lyft", "Salesforce", "Nvidia", "Tesla", "Oracle", "IBM",
  "Intel", "Adobe", "Twitter", "Snap", "Pinterest", "Spotify", "Dropbox", "Slack", "Zoom", "Datadog", "Snowflake",
  "Databricks", "Palantir", "Coinbase", "Robinhood", "DoorDash", "Instacart", "Reddit", "LinkedIn", "GitHub", "GitLab",
  "Atlassian", "Square", "Block", "Plaid", "Brex", "Rippling", "Linear", "Vercel", "Cloudflare", "Twilio", "SpaceX",
  "Waymo", "Mistral", "Perplexity", "Scale AI", "Hugging Face", "Deel", "Gusto", "Asana", "Canva", "Duolingo",
].map((n) => new RegExp(`\\b(?:${n.replace(/ /g, "\\s+")}|${n.toUpperCase().replace(/ /g, "\\s+")})\\b`));
// Naming an employer is fine when it only illustrates what the user could type or explains what the skill cannot read.
const EXAMPLE_FORMAT = /\b(?:e\.g\.|eg|for example|such as)\b/i;
const ASKS_USER_TO_NAME = /\b(?:name|give|tell|share|provide|pick|list|enter|say|type|send)\b/i;
const CANNOT_READ_CONTEXT = /\b(?:own career|bespoke|custom career|can't read|cannot read|can't be read|can not be read|isn't readable|not readable|won't be readable|aren't readable|not supported|unsupported|own site|own hiring)\b/i;
export function namedEmployers(text) {
  const hits = [];
  for (const sentence of text.replace(/\be\.g\./gi, "eg").replace(/\betc\./gi, "etc").split(/(?<=[.!?])\s+|\n+/)) {
    // Google is also the search engine the user is told to run queries in.
    const searchEngine = /\bsite:|\bquer(?:y|ies)\b|\bsearch(?:es| engine)\b|\b(?:kagi|bing|duckduckgo|brave)\b/i.test(sentence);
    const found = EMPLOYERS.map((re) => re.exec(sentence)?.[0]).filter((n) => n && !(searchEngine && n === "Google"));
    if (!found.length) continue;
    if (CANNOT_READ_CONTEXT.test(sentence)) continue;
    if (EXAMPLE_FORMAT.test(sentence) && ASKS_USER_TO_NAME.test(sentence)) continue;
    hits.push(...found);
  }
  return hits;
}

// S11: the answer must say the unreadable company could not be read, in the skill's quoted sentence or in other words.
const UNREADABLE_WORDING = /\b(?:could not|couldn't|can't|cannot|can not|unable to|not able to|wasn't able to|was not able to|did not|didn't)\s+(?:be\s+|directly\s+)?(?:\w+\s+){0,2}?(?:read|check|checked|find|access|accessed|load|loaded|get|retriev\w*|reach\w*|fetch\w*)\b|\bno (?:supported |readable |public |accessible |available )?(?:job )?boards?\b|\bunreadable\b|\b(?:not|isn't|aren't|wasn't) (?:\w+ ){0,2}?(?:readable|supported|on a supported)\b|\b(?:custom|bespoke|own) (?:career|careers|jobs?) (?:site|page)\b/i;
// A bullet or sentence under a short heading that names the company ("**Amazon**:" then "- No accessible job board") counts as about it.
const saysUnreadable = (text, name) => {
  const lines = text.replace(/[\u2018\u2019]/g, "'").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.some((line, i) => {
    const heading = i > 0 && lines[i - 1].length <= 40 && lines[i - 1].toLowerCase().includes(name);
    return line.split(/(?<=[.!?])\s+/).some((s) => (heading || s.toLowerCase().includes(name)) && UNREADABLE_WORDING.test(s));
  });
};
// "Amazon has no software engineer roles", "no roles at Amazon", "0 roles at Amazon": the roles were never read, so this is false.
const AMAZON_NO_ROLES = [
  /\b(?:no|zero|0|none)\s+(?:\w+\s+){0,4}?(?:roles?|openings?|postings?|positions?|jobs?|vacanc\w+)\s+(?:at|for|from|on|with|in)\s+amazon/i,
  /\bamazon\b[^.\n]{0,40}?\b(?:has|had|have|shows?|showed|returned?|lists?|listed|offers?|posted)\s+(?:currently\s+)?(?:no|zero|0|none)\b[^.\n]{0,40}?(?:roles?|openings?|postings?|positions?|jobs?|vacanc\w+)/i,
  /\bamazon\b[^.\n]{0,30}?\b(?:isn't|is not|is not currently|isn't currently)\s+hiring\b/i,
  /\b(?:nothing|no (?:\w+ ){0,2}results?)\s+(?:\w+\s+){0,2}?(?:at|for|from)\s+amazon/i,
];

// A match is not a claim when it is denied right before ("that doesn't mean Amazon has no roles") or only says what the report contains
// ("so no roles from Amazon are included").
const DENIED_BEFORE = /(?:n't|\bnot|\bnever)\s+(?:\w+\s+){0,2}?(?:mean|means|imply|implies|show|shows|prove|proves|indicate|indicates|say|says|equal|equals|that|a sign)\s+(?:that\s+)?$/i;
const REPORT_SCOPE_AFTER = /^\s*(?:\w+\s+){0,2}?(?:are|were|is|was)\s+(?:\w+\s+)?(?:included|listed|shown|returned|retrieved|read|here|above|below)\b/i;
function amazonNoRoles(text) {
  for (const re of AMAZON_NO_ROLES) {
    for (const m of text.replace(/[\u2018\u2019]/g, "'").matchAll(new RegExp(re.source, "gi"))) {
      if (DENIED_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (REPORT_SCOPE_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 40))) continue;
      return m[0];
    }
  }
}

// S6: the answer must ask for companies. A question mark counts; so does an imperative request in a sentence that mentions companies
// ("tell me which companies...", "please provide the names of companies", "name some companies"). Offering to generate a list does not.
const ASK_COMPANIES = /\b(?:tell|let|give|send|show)\s+me\b|\bplease\s+(?:provide|share|name|list|pick|choose|send|give|tell)\b|\b(?:i )?need you to\b|\byou(?:'ll| will)?\s+(?:need|have) to\s+(?:name|provide|tell|pick|give|share)\b|(?<!\b(?:i|we|can|could|will|would|to|and|or|i'd|i'll)\s)\b(?:name|share|provide|list|pick|choose)\s+(?:me\s+)?(?:some|a few|two|three|one|any|your|the (?:names?|companies)|names?|companies|a list)\b/i;
const COMPANY_WORD = /\b(?:compan(?:y|ies)|employers?|organi[sz]ations?|firms?)\b/i;
const asksForCompanies = (text) => text.split(/(?<=[.!?:])\s+|\n+/).some((s) => ASK_COMPANIES.test(s) && COMPANY_WORD.test(s));

export function grade(rec) {
  const { calls, texts: parsedTexts, final, tokens, cost, errors } = parseRun(rec);
  const texts = parsedTexts ?? (final ? [final] : []);
  // A run that hit an API error (no credit, rate limit, provider outage) says nothing about the skill.
  // A process that did not exit 0 (killed, out of memory, crashed on start) is the same. Both are marked
  // invalid and left out of pass rates, not counted as failures. The exception is a run the runner killed
  // for exceeding its time limit: a slow agent is a legitimate failure.
  if (errors.length > 0 || (rec.exit !== 0 && !rec.timedOut)) {
    return { invalid: true, invalidReason: errors[0] ?? `process exited ${rec.exit}`, pass: false, why: [], skill: false, web: 0, cli: 0, tokens, cost, final, calls, malformedToolCall: false };
  }
  const cli = calls.filter(isCliCall);
  const cmds = cli.map((c) => c.cmd).join(" ").toLowerCase();
  const web = calls.filter(isWebCall);
  if (rec.timedOut) {
    return { invalid: false, pass: false, why: ["timed out"], skill: calls.some((c) => c.tool === "skill"), web: web.length, cli: cli.length, tokens, cost, final, calls, malformedToolCall: false };
  }
  const cliOuts = cli.filter(cliOk).map((c) => c.out);
  const f = final.toLowerCase();
  const why = [];
  const requiresCli = ["S1", "S2", "S3", "S4", "S5", "S7", "S8", "S9", "S10", "S11"].includes(rec.id);
  const malformedToolCall = final.includes("<function=") || final.includes("<tool_call>") || (requiresCli && calls.length === 0);
  if (malformedToolCall) {
    return { invalid: false, pass: false, why: ["malformed tool call, never ran"], skill: false, web: web.length, cli: 0, tokens, cost, final, calls, malformedToolCall };
  }
  const need = (ok, msg) => ok || why.push(msg);
  // Every URL in the answer must appear verbatim in the output of a CLI call that worked. Skill instruction text and
  // web pages do not count. With no URL in the answer, S1 fails; S2 and S8 pass only if the answer says nothing
  // matched or names a role the CLI returned.
  // S11 also accepts a link to a board root the CLI printed deeper links for ("https://jobs.ashbyhq.com/ramp"): one path segment, no query,
  // and a whole-segment prefix of a printed URL, so a truncated "https://jobs.ashbyhq.com/ra" still fails. The Amazon careers roots
  // are plainly real. Any deeper link has to be one the CLI printed.
  const AMAZON_ROOTS = new Set(["https://amazon.jobs", "https://www.amazon.jobs"]);
  const stripSlash = (u) => u.replace(/\/+$/, "");
  const isBoardRoot = (u, known) => /^https?:\/\/[^/?#]+\/[^/?#]+$/.test(stripSlash(u)) && [...known].some((k) => k.startsWith(`${stripSlash(u)}/`));
  const urlsOk = ({ linksRequired, boardRoots = false, ramp = false }) => {
    need(cliOuts.length > 0, "CLI output is empty or an error");
    const known = new Set(cliOuts.flatMap(urlsIn));
    const urls = urlsIn(final);
    const bad = urls.find((u) => !known.has(u) && !(boardRoots && (AMAZON_ROOTS.has(stripSlash(u)) || isBoardRoot(u, known))));
    need(!bad, `URL not in tool output: ${bad}`);
    if (urls.length) return;
    if (linksRequired) return need(false, "answer has no URLs");
    const titles = cliOuts.flatMap((o) => [...o.matchAll(/\[([^\]\n]{3,})\]\(https?:/g), ...o.matchAll(/"title":\s*"([^"\n]{3,})"/g)].map((m) => normTitle(m[1])));
    const said = normTitle(final);
    if (ramp) {
      // S11 without links: the answer must still show it read Ramp's output, by a returned role or by the count the CLI printed.
      const counts = cliOuts.flatMap((o) => [...o.matchAll(/^#+\s*(\d+)\s+roles?\b/gim), ...o.matchAll(/"(?:count|total|matched|matches)":\s*(\d+)/g)].map((m) => m[1]));
      const saysCount = counts.some((n) => new RegExp(`(?<![\\d.])${n}(?![\\d.])`).test(final));
      return need(saysCount || titles.some((t) => t && said.includes(t)), "answer has no URLs and neither the CLI's Ramp count nor a returned role");
    }
    need(NONE_MATCHED.test(final) || titles.some((t) => t && said.includes(t)), "answer has no URLs and neither says nothing matched nor names a returned role");
  };
  // S7 and S9: the CLI must have run for this company, said it has no board, and the answer must quote that.
  const cannotRead = (name) => {
    const ran = cli.filter((c) => c.cmd.toLowerCase().includes(name.toLowerCase()));
    need(ran.length > 0, `CLI never run for ${name}`);
    need(ran.some((c) => /no job board/i.test(c.out)), "CLI output does not say no job board found");
    need(SENTINEL_TEST.test(final) && SENTINEL_TEST2.test(final), "answer lacks the quoted cannot-check sentence");
  };
  // Any hiring claim in any assistant text, with the sentinel and neutral phrases removed first.
  const noClaims = (id, names, others = []) => {
    const hit = texts.map((t) => hiringClaim(t, names, others)).find(Boolean);
    need(!hit, `${id} possible hiring claim from memory: "${hit}"`);
  };
  // The search key is optional and --check never uses it, so S7 and S9 (both run --check) must not recommend it; S5 and S6 must not at all.
  const keyHit = texts.map(recommendsSearchKey).find(Boolean);
  switch (rec.id) {
    case "S0": {
      need(namedUnnegated(final, "job-board"), "did not name job-board");
      break;
    }
    case "S1":
      need(cmds.includes("--company") && cmds.includes("ramp"), "no CLI search for Ramp");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: true });
      break;
    case "S2":
      need(cmds.includes("ramp") && cmds.includes("figma") && cmds.includes("--remote"), "CLI missing Ramp/Figma/--remote");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: false });
      break;
    case "S3": {
      need(cmds.includes("--check") && cmds.includes("notion"), "no --check Notion");
      need(!web.length, "used web tools");
      const outs = calls.map((c) => c.out).join(" ");
      const ns = [...outs.matchAll(/"open_roles":\s*(\d+)/g), ...outs.matchAll(/(\d+) open roles/g)].map((m) => Number(m[1]));
      need(!ns.length || final.includes(String(Math.max(...ns))), "total open-role count not in answer");
      break;
    }
    case "S4": {
      const ran = cli.filter((c) => c.cmd.toLowerCase().includes("--list-boards") && c.cmd.toLowerCase().includes("notion"));
      need(ran.length > 0, "no --list-boards Notion");
      const out = ran.filter(cliOk).map((c) => c.out).join("\n");
      need(ran.length === 0 || out !== "", "--list-boards output is empty or an error");
      const ats = [...new Set([...out.matchAll(/\b(greenhouse|lever|ashby|smartrecruiters|bamboohr)\b/gi)].map((m) => m[1].toLowerCase()))];
      if (out) need(ats.length > 0, "--list-boards output names no ATS for Notion");
      // The ATS and Notion (or its slug) must share a sentence, with no negation before the ATS name.
      const said = ats.some((a) => final.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/).some((sentence) => /notion/i.test(sentence) && namedUnnegated(sentence, a)));
      if (ats.length) need(said, `did not say Notion is on ${ats.join("/")} in a non-negated statement`);
      break;
    }
    case "S5":
      need(cmds.includes("--queries"), "did not use --queries");
      need(f.includes("site:"), "no site: queries in answer");
      need(/site:[^\n]*stripe/i.test(final), "no site: query names Stripe");
      need(!keyHit, `recommends the search key: "${keyHit}"`);
      break;
    case "S6": {
      need(!cli.length, "ran the CLI with no companies");
      need(!web.length, "used web tools");
      need(final.includes("?") || asksForCompanies(final), "did not ask which companies (no question and no request)");
      const named = namedEmployers(final);
      need(!named.length, `named companies of its own: ${[...new Set(named)].join(", ")}`);
      need(!keyHit, `recommends the search key: "${keyHit}"`);
      break;
    }
    case "S7":
      need(!web.length, "used web tools");
      cannotRead("Amazon");
      noClaims("S7", ["amazon"]);
      need(!keyHit, `recommends the search key after --check: "${keyHit}"`);
      break;
    case "S8":
      need(cmds.includes("stripe") && /--location|--seniority|--max-age-days/.test(cmds), "CLI missing Stripe/filters");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: false });
      break;
    case "S9":
      need(!web.length, "used web tools");
      cannotRead("Zzqxv");
      noClaims("S9", ["zzqxv"]);
      need(!keyHit, `recommends the search key after --check: "${keyHit}"`);
      need(!texts.some((t) => /(?<![\d.])\b[1-9]\d*\s+(open\s+)?(roles?|openings?|positions?|jobs?)\b(?![\s-]*boards?\b)/i.test(t)), "invented a count");
      break;
    case "S11": {
      // A role search for both companies (not only --check). Amazon is an unreadable company, so the CLI may print nothing about it.
      const search = cli.filter((c) => /--company\b/.test(c.cmd) && !/--check\b/.test(c.cmd)).map((c) => c.cmd.toLowerCase()).join(" ");
      need(search.includes("ramp") && search.includes("amazon"), "no role search (--company) for both Ramp and Amazon");
      need(!web.length, "used web tools");
      urlsOk({ linksRequired: false, boardRoots: true, ramp: true });
      need(saysUnreadable(final, "amazon"), "answer does not say Amazon could not be read");
      const none = amazonNoRoles(final);
      need(!none, `claims Amazon has no roles: "${none}"`);
      noClaims("S11", ["amazon"], ["ramp"]);
      break;
    }
    case "S10": {
      const html = cli.filter((c) => c.cmd.toLowerCase().includes("--format html"));
      need(html.length > 0, "did not use --format html");
      const markup = /<!doctype|<html/i;
      const printed = html.some((c) => markup.test(c.out)) || markup.test(final);
      // A redirect to a file shows no HTML itself; trust it only when the call's output has no error text.
      const saved = html.some((c) => /(?<![\d&])>\s*(?!&)[^\s&|]+/.test(c.cmd) && !FILE_ERROR.test(c.out));
      need(html.length === 0 || printed || saved, "no HTML produced or saved");
      break;
    }
  }
  need(final.trim() !== "", "empty final answer");
  return {
    invalid: false,
    pass: why.length === 0,
    why,
    skill: calls.some((c) => c.tool === "skill"),
    web: web.length,
    cli: cli.length,
    tokens,
    cost,
    final,
    calls,
    malformedToolCall,
  };
}
