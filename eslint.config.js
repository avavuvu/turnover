import js from "@eslint/js"
import prettier from "eslint-config-prettier/flat"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
	{ ignores: ["node_modules", "dist", "library"] },
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			"func-style": ["error", "expression"],
			"prefer-arrow-callback": "error",
			"@typescript-eslint/no-use-before-define": [
				"error",
				{ functions: false, classes: false, variables: false }
			],
			"@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"FunctionExpression:not(MethodDefinition > FunctionExpression, Property[method=true] > FunctionExpression, Property[kind='get'] > FunctionExpression, Property[kind='set'] > FunctionExpression)",
					message: "Use an arrow function."
				}
			]
		}
	},
	prettier
)
