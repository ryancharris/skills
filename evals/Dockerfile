FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode-ai
RUN useradd -m tester && mkdir /out && chmod 777 /out
USER tester
WORKDIR /home/tester
# skill.tar is `git archive <ref> skills/job-board`: committed files only, as a fresh clone would have
COPY --chown=tester skill.tar /tmp/skill.tar
RUN mkdir -p ~/.agents/skills /tmp/src && tar -xf /tmp/skill.tar -C /tmp/src && cp -r /tmp/src/skills/job-board ~/.agents/skills/ && rm -rf /tmp/src /tmp/skill.tar
COPY --chown=tester stories.json run.mjs /evals/
RUN mkdir -p /home/tester/work
WORKDIR /home/tester/work
