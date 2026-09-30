.PHONY: watch

PKGS := packages/core packages/verifier packages/server packages/flow examples/slips
TIP  := http%3A%2F%2Flocalhost%3A4010%2Ftip

# The slip page in dev mode, with every package it reads rebuilt on save.
watch:
	pnpm turbo run build --filter=@cardano-slips/page^... --filter=@cardano-slips/example-slips
	@printf '\n  page:  %s\n  flow:  %s\n\n' 'http://localhost:3000/?uri=$(TIP)' 'http://localhost:3000/preview/flow?uri=$(TIP)&wallet=signs'
	@trap 'kill 0' INT TERM EXIT; \
	pnpm exec tsc -b --watch --preserveWatchOutput $(addsuffix /tsconfig.build.json,$(PKGS)) & \
	while :; do rsync -a packages/flow/src/*.css packages/flow/dist/; sleep 1; done & \
	node --watch examples/slips/dist/serve.js & \
	pnpm --filter @cardano-slips/page dev & \
	wait
