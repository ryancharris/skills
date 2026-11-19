/**
 * The company on a job. An ATS that sends no company name (Lever, Ashby,
 * BambooHR) used to leave the slug on every job ("cohere"), while the board
 * listing showed the name searched ("Cohere"). The board's name is now passed to
 * the adapter, and a vendor-supplied name still wins.
 *
 * Each adapter's HTTP call is replaced by a synthetic payload; nothing touches
 * the network.
 */

import { describe, expect, it } from "vitest";

import {
  AshbyAdapter,
  BambooHRAdapter,
  GreenhouseAdapter,
  LeverAdapter,
  SmartRecruitersAdapter,
} from "../src/ats.js";
import { discoverBoards } from "../src/discovery.js";
import { fetchBoard } from "../src/pipeline.js";

type Payload = Record<string, unknown>;

class FakeAshby extends AshbyAdapter {
  constructor(private readonly payload: unknown) {
    super();
  }
  protected override async get(): Promise<Payload> {
    return this.payload as Payload;
  }
}

class FakeLever extends LeverAdapter {
  constructor(private readonly payload: unknown) {
    super();
  }
  protected override async get(): Promise<Payload> {
    return this.payload as Payload;
  }
}

class FakeBamboo extends BambooHRAdapter {
  constructor(private readonly payload: unknown) {
    super();
  }
  protected override async get(): Promise<Payload> {
    return this.payload as Payload;
  }
}

class FakeGreenhouse extends GreenhouseAdapter {
  constructor(private readonly payload: unknown) {
    super();
  }
  protected override async get(url: string): Promise<Payload> {
    return url.endsWith("/departments") ? {} : (this.payload as Payload);
  }
}

class FakeSmartRecruiters extends SmartRecruitersAdapter {
  constructor(private readonly payload: unknown) {
    super();
  }
  protected override async get(): Promise<Payload> {
    return this.payload as Payload;
  }
}

const ashbyPayload = { jobs: [{ id: "1", title: "Engineer", location: "Toronto", jobUrl: "https://jobs.ashbyhq.com/cohere/1" }] };
const leverPayload = [{ id: "1", text: "Engineer", hostedUrl: "https://jobs.lever.co/palantir/1", categories: {} }];
const bamboo = { result: [{ id: "1", jobOpeningName: "Engineer", location: {} }] };
const greenhouse = (company_name?: string) => ({
  jobs: [{ id: 1, title: "Engineer", ...(company_name ? { company_name } : {}), absolute_url: "https://x.test/1", location: { name: "NYC" } }],
});
const smart = (name?: string) => ({
  totalFound: 1,
  content: [{ id: "1", name: "Engineer", location: {}, ...(name ? { company: { name } } : {}) }],
});

describe("company on a job when the vendor sends no name", () => {
  it("Ashby uses the board's name", async () => {
    const adapter = new FakeAshby(ashbyPayload);
    expect((await adapter.fetch("cohere", "Cohere"))[0]?.company).toBe("Cohere");
    expect((await adapter.fetchRead("cohere", "Cohere")).jobs[0]?.company).toBe("Cohere");
  });

  it("Lever uses the board's name", async () => {
    const adapter = new FakeLever(leverPayload);
    expect((await adapter.fetch("palantir", "Palantir"))[0]?.company).toBe("Palantir");
  });

  it("BambooHR uses the board's name", async () => {
    const adapter = new FakeBamboo(bamboo);
    expect((await adapter.fetch("acme", "Acme"))[0]?.company).toBe("Acme");
  });

  it("falls back to the slug when no name is given (discovery probes this way)", async () => {
    expect((await new FakeAshby(ashbyPayload).fetch("cohere"))[0]?.company).toBe("cohere");
    expect((await new FakeLever(leverPayload).fetch("palantir"))[0]?.company).toBe("palantir");
    expect((await new FakeBamboo(bamboo).fetch("acme"))[0]?.company).toBe("acme");
  });
});

describe("a vendor-supplied company name is kept", () => {
  it("Greenhouse company_name wins over the board's name", async () => {
    const adapter = new FakeGreenhouse(greenhouse("Stripe, Inc."));
    expect((await adapter.fetch("stripe", "Stripe"))[0]?.company).toBe("Stripe, Inc.");
  });

  it("Greenhouse without company_name uses the board's name, then the slug", async () => {
    const adapter = new FakeGreenhouse(greenhouse());
    expect((await adapter.fetch("stripe", "Stripe"))[0]?.company).toBe("Stripe");
    expect((await adapter.fetch("stripe"))[0]?.company).toBe("stripe");
  });

  it("SmartRecruiters company.name wins; without it the board's name is used", async () => {
    const named = new FakeSmartRecruiters(smart("Canva Pty"));
    expect((await named.fetch("canva", "Canva"))[0]?.company).toBe("Canva Pty");
    const unnamed = new FakeSmartRecruiters(smart());
    expect((await unnamed.fetch("canva", "Canva"))[0]?.company).toBe("Canva");
    expect((await unnamed.fetch("canva"))[0]?.company).toBe("canva");
  });
});

describe("the pipeline passes the board's name through", () => {
  it("fetchBoard labels jobs with board.company", async () => {
    const adapter = new FakeAshby(ashbyPayload);
    const read = await fetchBoard(
      { company: "Cohere", ats: "ashby", slug: "cohere", job_count: 1, url: "" },
      [adapter],
      adapter.timeout,
    );
    expect(read.jobs.map((j) => j.company)).toEqual(["Cohere"]);
  });

  it("discovery still verifies identity with the slug probe (no name given)", async () => {
    const adapter = new FakeGreenhouse(greenhouse("General Interest"));
    expect(await discoverBoards("General Motors", { adapters: [adapter] })).toEqual([]);
  });
});
