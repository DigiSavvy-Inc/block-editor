import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Runes mode for this project's own files (the library and the demo).
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	// The demo (src/routes) builds to a static site; the library is built by svelte-package.
	kit: { adapter: adapter() }
};

export default config;
