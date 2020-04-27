var _ = require('lodash');
var test = require('ava');
var nearley = require('nearley');
var ojsonGrammar = require('../formula/grammars/ojson.js');
var parseOjson = require('../formula/parse_ojson').parse

function parseOjsonRaw (text) {
	try {
		var parser = new nearley.Parser(nearley.Grammar.fromCompiled(ojsonGrammar));
		parser.feed(text);
		if (!_.isArray(parser.results)) {
			return 'parserResult should be Array'
		}
		if (parser.results.length !== 1) {
			return 'parserResult should be Array of length 1'
		}
		return parser.results[0]
	} catch (e) {
		return e;
	}
}

test.after.always(t => {
	console.log('***** ojson.test done');
});

test('Key names', t => {
	var text = `{
	true: "somestr",
	false: "somestr",
	agents: [
		{ 'autonomous agent': 'somestr', },
		{ "autonomous agent": 'somestr', },
		{ \`autonomous agent\`: 'somestr', }
	],
	'string with spaces': 'somestr'
}`

	var expected = {
		type: "OBJECT",
		value: [
			{
				type: "PAIR",
				key: {  type: "STR",  value: "true",  context: {  col: 2,  line: 2,  offset: 3,  lineBreaks: 0 }  },
				value: {  type: "STR",  value: "somestr",  context: {  col: 8,  line: 2,  offset: 9,  lineBreaks: 0 }  },
				context: {  col: 6,  line: 2,  offset: 7,  lineBreaks: 0  }},
				{
					type: "PAIR",
					key: {  type: "STR",  value: "false",  context: {  col: 2,  line: 3,  offset: 21,  lineBreaks: 0 }  },
					value: {  type: "STR",  value: "somestr",  context: {  col: 9,  line: 3,  offset: 28,  lineBreaks: 0 }  },
					context: {  col: 7,  line: 3,  offset: 26,  lineBreaks: 0  }},
					{
						type: "PAIR",
						key: {  type: "STR",  value: "agents",  context: {  col: 2,  line: 4,  offset: 40,  lineBreaks: 0 }  },
						value: {
							type: "ARRAY",
							value: [
								{
									type: "OBJECT",
									value: [
										{
											type: "PAIR",
											key: {  type: "STR",  value: "autonomous agent",  context: {  col: 5,  line: 5,  offset: 54,  lineBreaks: 0 }  },
											value: {  type: "STR",  value: "somestr",  context: {  col: 25,  line: 5,  offset: 74,  lineBreaks: 0 }  },
											context: {  col: 23,  line: 5,  offset: 72,  lineBreaks: 0  }
										}
									],
									context: { col: 3, line: 5, offset: 52, lineBreaks: 0   }
								},
								{
									type: "OBJECT",
									value: [
										{
											type: "PAIR",
											key: {  type: "STR",  value: "autonomous agent",  context: {  col: 5,  line: 6,  offset: 92,  lineBreaks: 0 }  },
											value: {  type: "STR",  value: "somestr",  context: {  col: 25,  line: 6,  offset: 112,  lineBreaks: 0 }  },
											context: {  col: 23,  line: 6,  offset: 110,  lineBreaks: 0  }
										}
									],
									context: { col: 3, line: 6, offset: 90, lineBreaks: 0   }
								},
								{
									type: "OBJECT",
									value: [
										{
											type: "PAIR",
											key: {  type: "STR",  value: "autonomous agent",  context: {  col: 5,  line: 7,  offset: 130,  lineBreaks: 0 }  },
											value: {  type: "STR",  value: "somestr",  context: {  col: 25,  line: 7,  offset: 150,  lineBreaks: 0 }  },
											context: {  col: 23,  line: 7,  offset: 148,  lineBreaks: 0  }
										}
									],
									context: { col: 3, line: 7, offset: 128, lineBreaks: 0   } }
							],
							context: {  col: 10,  line: 4,  offset: 48,  lineBreaks: 0 }
						},
						context: {  col: 8,  line: 4,  offset: 46,  lineBreaks: 0  }},
					{
						type: "PAIR",
						key: {  type: "STR",  value: "string with spaces",  context: {  col: 2,  line: 9,  offset: 168,  lineBreaks: 0 }  },
						value: {  type: "STR",  value: "somestr",  context: {  col: 24,  line: 9,  offset: 190,  lineBreaks: 0 }  },
						context: {  col: 22,  line: 9,  offset: 188,  lineBreaks: 0  }
					}
				],
				context: { col: 1, line: 1, offset: 0, lineBreaks: 0
				}
			}

	t.deepEqual(parseOjsonRaw(text), expected)

	parseOjson(text, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				true: "somestr",
				false: "somestr",
				agents: [
					{ 'autonomous agent': 'somestr', },
					{ 'autonomous agent': 'somestr', },
					{ 'autonomous agent': 'somestr', }
				],
				'string with spaces': 'somestr'
			}
		]
	)});
})

test('Formula in quotes', t => {
	var singleQuoted = `{
	formula: '{trigger.output[[asset=base]] - 1000}',
}`
	var doubleQuoted = `{
	formula: "{trigger.output[[asset=base]] - 1000}",
}`
	var backQuoted = `{
	formula: \`{trigger.output[[asset=base]] - 1000}\`,
}`

	var expected = {
		type: "OBJECT",
		value: [
			{
				type: "PAIR",
				key: {
					type: "STR",
					value: "formula",
					context: {
						col: 2,
						line: 2,
						offset: 3,
						lineBreaks: 0
					}
				},
				value: {
					type: "FORMULA",
					value: "trigger.output[[asset=base]] - 1000",
					context: {
						col: 13,
						line: 2,
						offset: 14,
						lineBreaks: 0
					}
				},
				context: {
					col: 9,
					line: 2,
					offset: 10,
					lineBreaks: 0
				}
			}
		],
		context: {
			col: 1,
			line: 1,
			offset: 0,
			lineBreaks: 0
		}
	}

	t.deepEqual(parseOjsonRaw(singleQuoted), expected)
	t.deepEqual(parseOjsonRaw(doubleQuoted), expected)
	t.deepEqual(parseOjsonRaw(backQuoted), expected)
})

test('Date string', t => {
	var text = `{
	expiry: "2020-01-31"
}`

	var expected = {
		type: "OBJECT",
		value: [
			{
				type: "PAIR",
				key: {
					type: "STR",
					value: "expiry",
					context: {
						col: 2,
						line: 2,
						offset: 3,
						lineBreaks: 0
					}
				},
				value: {
					type: "STR",
					value: "2020-01-31",
					context: {
						col: 10,
						line: 2,
						offset: 11,
						lineBreaks: 0
					}
				},
				context: {
					col: 8,
					line: 2,
					offset: 9,
					lineBreaks: 0
				}
			}
		],
		context: {
			col: 1,
			line: 1,
			offset: 0,
			lineBreaks: 0
		}
	}

	t.deepEqual(parseOjsonRaw(text), expected)
})

test('Multiline formula', t => {
	var text =
`{
	formula: "{
		$share = $asset_amount / var['team_' || $winner || '_amount'];
		$founder_tax = var['team_' || $winner || '_founder_tax'];
		$amount = round(( $share * (1-$founder_tax) + (trigger.address == $winner AND !var['founder_tax_paid'] ? $founder_tax : 0) ) * var['total']);
	}"
}`

	var expected = {
		type: "OBJECT",
		value: [
			{
				type: "PAIR",
				key: {
					type: "STR",
					value: "formula",
					context: {
						col: 2,
						line: 2,
						offset: 3,
						lineBreaks: 0
					}
				},
				value: {
					type: "FORMULA",
					value: "\n\t\t$share = $asset_amount / var['team_' || $winner || '_amount'];\n\t\t$founder_tax = var['team_' || $winner || '_founder_tax'];\n\t\t$amount = round(( $share * (1-$founder_tax) + (trigger.address == $winner AND !var['founder_tax_paid'] ? $founder_tax : 0) ) * var['total']);\n\t",
					context: {
						col: 13,
						line: 2,
						offset: 14,
						lineBreaks: 4
					}
				},
				context: {
					col: 9,
					line: 2,
					offset: 10,
					lineBreaks: 0
				}
			}
		],
		context: {
			col: 1,
			line: 1,
			offset: 0,
			lineBreaks: 0
		}
	}

	t.deepEqual(parseOjsonRaw(text), expected)
})

test('Ojson values', t => {
	var ojson = `{
	decimal: 123,
	negative_decimal: -123,
	decimal2: 1.23,
	negative_decimal2: -1.23,
	true_value: true,
	false_value: false,
	exponential_number: 1e6,
	negative_exponential_number: -1e3,
	exponential_number2: 5e+6,
	negative_exponential_number2: -1e+3,
	exponential_number3: 0.22E-3,
	negative_exponential_number3: -0.5e-4,
	singleQuotedString: 'this is a string',
	doubleQuotedString: "this is a string",
	backQuotedString: \`this is a string\`,
	aaValue: "autonomous agent",
	aaValueString: "autonomous agent string string",
	stringStartsWithDecimal: "123string",
	formula: "{trigger.output[[asset=base]] - 1000}",
}`

	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				decimal: 123,
				negative_decimal: -123,
				decimal2: 1.23,
				negative_decimal2: -1.23,
				true_value: true,
				false_value: false,
				exponential_number: 1000000,
				negative_exponential_number: -1000,
				exponential_number2: 5000000,
				negative_exponential_number2: -1000,
				exponential_number3: 0.00022,
				negative_exponential_number3: -0.00005,
				singleQuotedString: "this is a string",
				doubleQuotedString: "this is a string",
				backQuotedString: "this is a string",
				aaValue: "autonomous agent",
				aaValueString: "autonomous agent string string",
				stringStartsWithDecimal: "123string",
				formula: "{trigger.output[[asset=base]] - 1000}",
			}
		]
	)});
});

test('Single quoted string with escape', t => {
	var ojson = `
{
	string: 'this is a \\' string',
}
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				string: "this is a \\' string"
			}
		]
	)});
});

test('Double quoted string with escape', t => {
	var ojson = `
{
	string: "this is a \\" string",
}
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				string: 'this is a \\" string'
			}
		]
	)});
});

test('Back quoted string with escape', t => {
	var ojson = "{ string: `this is a \\` string` }"

	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				string: 'this is a \\` string'
			}
		]
	)});
});

test('Disallow newline in string single quoted', t => {
	var ojson = `{ string: 'newline shall not
pass' }`

	parseOjson(ojson, (err, res) => { t.regex(err, /^ojson parsing failed: Error: invalid syntax at line 1 col 11:/)});
});

test('Disallow newline in string double quoted', t => {
	var ojson = `{ string: "newline shall not
pass" }`

	parseOjson(ojson, (err, res) => { t.regex(err, /^ojson parsing failed: Error: invalid syntax at line 1 col 11:/)});
});

test('Disallow newline in string back quoted', t => {
	var ojson = `{ string: \`newline shall not
pass\` }`

	parseOjson(ojson, (err, res) => { t.regex(err, /^ojson parsing failed: Error: invalid syntax at line 1 col 11:/)});
});

test('Simple message', t => {
	var ojson = `
{
	messages: [
		{
			app: 'payment'
		}
	]
}
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [{ app: "payment" }]
			}
		]
	)});
});

test('Wrong formula', t => {
	var ojson = `
{
	key: '{$wrong $formula}',
}
`
	parseOjson(ojson, (err, res) => { t.regex(err, /^Invalid formula syntax at/)})
});

test('Single line array', t => {
	var ojson = `
{
	messages: [1, 2, 3]
}
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [1, 2, 3]
			}
		]
	)});
});

test('Object values', t => {
	var ojson = `
{
	messages: [
		{
			app: 'payment',
			one: true,
			two: false,
			three: [ 1, 2, 3 ],
			four: 'quotedstring',
			five: "doublequotedstring",
			six: \`backquotedstring\`,
			seven: 123.123,
			eigth: true,
			nine: false,
			ten: '{trigger.output[[asset=base]] - 1000}',
		}
	]
}
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [
					{
						app: 'payment',
						one: true,
						two: false,
						three: [ 1, 2, 3 ],
						four: 'quotedstring',
						five: 'doublequotedstring',
						six: 'backquotedstring',
						seven: 123.123,
						eigth: true,
						nine: false,
						ten: '{trigger.output[[asset=base]] - 1000}',
					}
				]
			}
		]
	)});
});

test('Array values', t => {
	var ojson = `
{
	messages: [
		{
			message1: 'payment'
		},
		{
			message2: 'payment2'
		},
		[ 1, 2, 3 ],
		'quotedstring',
		"doublequotedstring",
		\`backquotedstring\`,
		123.123,
		true,
		false,
		'{trigger.output[[asset=base]] - 1000}',
	]
}
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [
					{ message1: "payment" },
					{ message2: "payment2" },
					[
						1,
						2,
						3
					],
					'quotedstring',
					'doublequotedstring',
					'backquotedstring',
					123.123,
					true,
					false,
					'{trigger.output[[asset=base]] - 1000}',
				]
			}
		]
	)});
});

test('Array ojson single quotes', t => {
	var ojson = `
[
	'autonomous agent',
	{
		messages: [
			{
				app: 'payment'
			}
		]
	}
]
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [{ app: "payment" }]
			}
		]
	)});
});

test('Array ojson double quotes', t => {
	var ojson = `
[
	"autonomous agent",
	{
		messages: [
			{
				app: 'payment'
			}
		]
	}
]
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [{ app: "payment" }]
			}
		]
	)});
});

test('Array ojson back quotes', t => {
	var ojson = `
[
	\`autonomous agent\`,
	{
		messages: [
			{
				app: 'payment'
			}
		]
	}
]
`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [{ app: "payment" }]
			}
		]
	)});
});

test('Parameterized AA', t => {
	var ojson = `{
	base_aa: 'JWXDH7IFMHIXFXVPCSMHJAY5DD7IMLSG',
	params: {expiry: "2020-01-31", fee: 2000}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				base_aa: 'JWXDH7IFMHIXFXVPCSMHJAY5DD7IMLSG',
				params: {expiry: "2020-01-31", fee: 2000}
			}
		]
	)});
});



/* ===== oscript-editor templates ===== */

test('Just a bouncer', t => {
	var ojson = `{
	bounce_fees: { base: 10000 },
	messages: [
		{
			app: 'payment',
			payload: {
				asset: 'base',
				outputs: [
					{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 1000}"}
				]
			}
		}
	]
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				bounce_fees: { base: 10000 },
				messages: [{
					app: "payment",
					payload: {
						asset: "base",
						outputs: [
							{
								address: "{trigger.address}",
								amount: "{trigger.output[[asset=base]] - 1000}"
							}
						]
					}
				}]
			}
		]
	)});
});

test('Forwarder of bytes', t => {
	var ojson = `{
	messages: [
		{
			if: '{trigger.output[[asset=base]] > 2000}',
			app: 'payment',
			payload: {
				asset: "base",
				outputs: [
					{ address: "PCEJIRXNA56T6VQOOSPV6GOJVLVN6AO6", amount: "{ trigger.output[[asset=base]] - 2000 }" }
				]
			}
		},
	]
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [
					{
						if: '{trigger.output[[asset=base]] > 2000}',
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [
								{ address: "PCEJIRXNA56T6VQOOSPV6GOJVLVN6AO6", amount: "{ trigger.output[[asset=base]] - 2000 }" }
							]
						}
					},
				]
			}
		]
	)});
});

test('Bounce half of balance', t => {
	var ojson = `{
	bounce_fees: { base: 10000 },
	messages: [
		{
			app: 'payment',
			payload: {
				asset: 'base',
				outputs: [
					{address: "{trigger.address}", amount: "{ round(balance[base]/2) }"}
				]
			}
		}
	]
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				bounce_fees: { base: 10000 },
				messages: [
					{
						app: 'payment',
						payload: {
							asset: 'base',
							outputs: [
								{address: "{trigger.address}", amount: "{ round(balance[base]/2) }"}
							]
						}
					}
				]
			}
		]
	)});
});

test('Create an asset', t => {
	var ojson = `{
	bounce_fees: { base: 11000 },
	messages: {
		cases: [
			{
				if: "{trigger.data.define}",
				messages: [
					{
						app: 'asset',
						payload: {
							cap: "{trigger.data.cap otherwise ''}",
							is_private: false,
							is_transferrable: true,
							auto_destroy: "{!!trigger.data.auto_destroy}",
							fixed_denominations: false,
							issued_by_definer_only: "{!!trigger.data.issued_by_definer_only}",
							cosigned_by_definer: false,
							spender_attested: "{!!trigger.data.attestor1}",
							attestors: [
								"{trigger.data.attestor1 otherwise ''}",
								"{trigger.data.attestor2 otherwise ''}",
								"{trigger.data.attestor3 otherwise ''}",
							]
						}
					},
					{
						app: 'state',
						state: "{ var[response_unit] = trigger.address; }"
					}
				]
			},
			{
				if: "{trigger.data.issue AND trigger.data.asset AND var[trigger.data.asset] == trigger.address}",
				messages: [{
					app: 'payment',
					payload: {
						asset: "{trigger.data.asset}",
						outputs: [
							{address: "{trigger.address}", amount: "{trigger.data.amount}"}
						]
					}
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				bounce_fees: { base: 11000 },
				messages: {
					cases: [
						{
							if: "{trigger.data.define}",
							messages: [
								{
									app: 'asset',
									payload: {
										cap: "{trigger.data.cap otherwise ''}",
										is_private: false,
										is_transferrable: true,
										auto_destroy: "{!!trigger.data.auto_destroy}",
										fixed_denominations: false,
										issued_by_definer_only: "{!!trigger.data.issued_by_definer_only}",
										cosigned_by_definer: false,
										spender_attested: "{!!trigger.data.attestor1}",
										attestors: [
											"{trigger.data.attestor1 otherwise ''}",
											"{trigger.data.attestor2 otherwise ''}",
											"{trigger.data.attestor3 otherwise ''}",
										]
									}
								},
								{
									app: 'state',
									state: "{ var[response_unit] = trigger.address; }"
								}
							]
						},
						{
							if: "{trigger.data.issue AND trigger.data.asset AND var[trigger.data.asset] == trigger.address}",
							messages: [{
								app: 'payment',
								payload: {
									asset: "{trigger.data.asset}",
									outputs: [
										{address: "{trigger.address}", amount: "{trigger.data.amount}"}
									]
								}
							}]
						},
					]
				}
			}
		]
	)});
});

test('Sell asset for Bytes', t => {
	var ojson = `{
	init: \`{
		$my_address = '2QHG44PZLJWD2H7C5ZIWH4NZZVB6QCC7';
	}\`,
	messages: {
		cases: [
			{ // withdraw funds
				if: "{trigger.data.withdraw AND trigger.data.asset AND trigger.data.amount AND trigger.address == $my_address}",
				messages: [{
					app: 'payment',
					payload: {
						asset: "{trigger.data.asset}",
						outputs: [
							{address: "{trigger.address}", amount: "{trigger.data.amount}"}
						]
					}
				}]
			},
			{ // update exchange rate
				if: "{trigger.data.exchange_rate AND trigger.address == $my_address}",
				messages: [{
					app: 'state',
					state: "{ var['rate'] = trigger.data.exchange_rate; response['message'] = 'set exchange rate to '||var['rate']||' tokens/byte'; }"  // asset-units/byte
				}]
			},
			{ // exchange
				if: "{trigger.output[[asset=base]] > 100000}",
				init: "{ $bytes_amount = trigger.output[[asset=base]]; $asset_amount = round($bytes_amount * var['rate']); response['message'] = 'exchanged '||$bytes_amount||' bytes for '||$asset_amount||' asset.'; }",
				messages: [{
					app: 'payment',
					payload: {
						asset: "n9y3VomFeWFeZZ2PcSEcmyBb/bI7kzZduBJigNetnkY=",
						outputs: [
							{address: "{trigger.address}", amount: "{ $asset_amount }"}
						]
					}
				}]
			},
			{ // silently accept coins
				messages: [{
					app: 'state',
					state: "{ response['message'] = 'accepted coins: '||trigger.output[[asset=base]]||' bytes and '||trigger.output[[asset='n9y3VomFeWFeZZ2PcSEcmyBb/bI7kzZduBJigNetnkY=']]||' tokens.'; }"
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$my_address = '2QHG44PZLJWD2H7C5ZIWH4NZZVB6QCC7';
	}`,
				messages: {
					cases: [
						{
							if: "{trigger.data.withdraw AND trigger.data.asset AND trigger.data.amount AND trigger.address == $my_address}",
							messages: [{
								app: 'payment',
								payload: {
									asset: "{trigger.data.asset}",
									outputs: [
										{address: "{trigger.address}", amount: "{trigger.data.amount}"}
									]
								}
							}]
						},
						{
							if: "{trigger.data.exchange_rate AND trigger.address == $my_address}",
							messages: [{
								app: 'state',
								state: "{ var['rate'] = trigger.data.exchange_rate; response['message'] = 'set exchange rate to '||var['rate']||' tokens/byte'; }"  // asset-units/byte
							}]
						},
						{
							if: "{trigger.output[[asset=base]] > 100000}",
							init: "{ $bytes_amount = trigger.output[[asset=base]]; $asset_amount = round($bytes_amount * var['rate']); response['message'] = 'exchanged '||$bytes_amount||' bytes for '||$asset_amount||' asset.'; }",
							messages: [{
								app: 'payment',
								payload: {
									asset: "n9y3VomFeWFeZZ2PcSEcmyBb/bI7kzZduBJigNetnkY=",
									outputs: [
										{address: "{trigger.address}", amount: "{ $asset_amount }"}
									]
								}
							}]
						},
						{
							messages: [{
								app: 'state',
								state: "{ response['message'] = 'accepted coins: '||trigger.output[[asset=base]]||' bytes and '||trigger.output[[asset='n9y3VomFeWFeZZ2PcSEcmyBb/bI7kzZduBJigNetnkY=']]||' tokens.'; }"
							}]
						},
					]
				}
			}
		]
	)});
});

test('Bank with deposits without interest', t => {
	var ojson = `{
	messages: {
		cases: [
			{ // withdraw funds
				if: \`{
					$key = 'balance_'||trigger.address||'_'||trigger.data.asset;
					$base_key = 'balance_'||trigger.address||'_'||'base';
					$fee = 1000;
					$required_amount = trigger.data.amount + ((trigger.data.asset == 'base') ? $fee : 0);
					trigger.data.withdraw AND trigger.data.asset AND trigger.data.amount AND $required_amount <= var[$key] AND $fee <= var[$base_key]
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{trigger.data.asset}",
							outputs: [
								{address: "{trigger.address}", amount: "{trigger.data.amount}"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var[$key] = var[$key] - trigger.data.amount;
							var[$base_key] = var[$base_key] - $fee;
						}\`
					}
				]
			},
			{ // silently accept coins
				if: "{!trigger.data.withdraw}",
				messages: [{
					app: 'state',
					state: \`{
						$asset = trigger.output[[asset!=base]].asset;
						if ($asset == 'ambiguous')
							bounce('ambiguous asset');
						if (trigger.output[[asset=base]] > 10000){
							$base_key = 'balance_'||trigger.address||'_'||'base';
							var[$base_key] = var[$base_key] + trigger.output[[asset=base]];
							$response_base = trigger.output[[asset=base]] || ' bytes\\n';
						}
						if ($asset != 'none'){
							$asset_key = 'balance_'||trigger.address||'_'||$asset;
							var[$asset_key] = var[$asset_key] + trigger.output[[asset=$asset]];
							$response_asset = trigger.output[[asset=$asset]] || ' of ' || $asset || '\\n';
						}
						response['message'] = 'accepted coins:\\n' || ($response_base otherwise '') || ($response_asset otherwise '');
					}\`
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: {
					cases: [
						{
							if: `{
					$key = 'balance_'||trigger.address||'_'||trigger.data.asset;
					$base_key = 'balance_'||trigger.address||'_'||'base';
					$fee = 1000;
					$required_amount = trigger.data.amount + ((trigger.data.asset == 'base') ? $fee : 0);
					trigger.data.withdraw AND trigger.data.asset AND trigger.data.amount AND $required_amount <= var[$key] AND $fee <= var[$base_key]
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{trigger.data.asset}",
										outputs: [
											{address: "{trigger.address}", amount: "{trigger.data.amount}"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							var[$key] = var[$key] - trigger.data.amount;
							var[$base_key] = var[$base_key] - $fee;
						}`
								}
							]
						},
						{
							if: "{!trigger.data.withdraw}",
							messages: [{
								app: 'state',
								state: `{
						$asset = trigger.output[[asset!=base]].asset;
						if ($asset == 'ambiguous')
							bounce('ambiguous asset');
						if (trigger.output[[asset=base]] > 10000){
							$base_key = 'balance_'||trigger.address||'_'||'base';
							var[$base_key] = var[$base_key] + trigger.output[[asset=base]];
							$response_base = trigger.output[[asset=base]] || ' bytes\\n';
						}
						if ($asset != 'none'){
							$asset_key = 'balance_'||trigger.address||'_'||$asset;
							var[$asset_key] = var[$asset_key] + trigger.output[[asset=$asset]];
							$response_asset = trigger.output[[asset=$asset]] || ' of ' || $asset || '\\n';
						}
						response['message'] = 'accepted coins:\\n' || ($response_base otherwise '') || ($response_asset otherwise '');
					}`
							}]
						},
					]
				}
			}
		]
	)});
});

test('Option contract', t => {
	var ojson = `{
	messages: {
		cases: [
			{ // define YES and NO assets
				if: \`{
					$define_yes = trigger.data.define_yes AND !var['yes_asset'];
					$define_no = trigger.data.define_no AND !var['no_asset'];
					if ($define_yes AND $define_no)
						bounce("can't define both assets at the same time");
					$define_yes OR $define_no
				}\`,
				messages: [
					{
						app: 'asset',
						payload: {
							// without cap
							is_private: false,
							is_transferrable: true,
							auto_destroy: false,
							fixed_denominations: false,
							issued_by_definer_only: true,
							cosigned_by_definer: false,
							spender_attested: false,
						}
					},
					{
						app: 'state',
						state: \`{
							$asset = $define_yes ? 'yes_asset' : 'no_asset';
							var[$asset] = response_unit;
							response[$asset] = response_unit;
						}\`
					}
				]
			},
			{ // issue YES and NO assets in exchange for bytes
				if: "{trigger.output[[asset=base]] >= 1e5 AND var['yes_asset'] AND var['no_asset']}",
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{var['yes_asset']}",
							outputs: [
								{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
							]
						}
					},
					{
						app: 'payment',
						payload: {
							asset: "{var['no_asset']}",
							outputs: [
								{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
							]
						}
					},
				]
			},
			{ // record the outcome
				if: \`{(trigger.data.winner == 'yes' OR trigger.data.winner == 'no') AND !var['winner']}\`,
				messages: [{
					app: 'state',
					state: \`{
						if (trigger.data.winner == 'yes' AND data_feed[[oracles='X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', feed_name='GBYTE_USD']] > 60)
							var['winner'] = 'yes';
						else if (trigger.data.winner == 'no' AND timestamp > 1556668800)
							var['winner'] = 'no';
						else
							bounce('suggested outcome not confirmed');
						response['winner'] = trigger.data.winner;
					}\`
				}]
			},
			{ // pay bytes in exchange for the winning asset
				if: "{trigger.output[[asset!=base]] > 1000 AND var['winner'] AND trigger.output[[asset!=base]].asset == var[var['winner'] || '_asset']}",
				messages: [{
					app: 'payment',
					payload: {
						asset: "base",
						outputs: [
							{address: "{trigger.address}", amount: "{ trigger.output[[asset!=base]] }"}
						]
					}
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: {
					cases: [
						{ // define YES and NO assets
							if: `{
					$define_yes = trigger.data.define_yes AND !var['yes_asset'];
					$define_no = trigger.data.define_no AND !var['no_asset'];
					if ($define_yes AND $define_no)
						bounce("can't define both assets at the same time");
					$define_yes OR $define_no
				}`,
							messages: [
								{
									app: 'asset',
									payload: {
										// without cap
										is_private: false,
										is_transferrable: true,
										auto_destroy: false,
										fixed_denominations: false,
										issued_by_definer_only: true,
										cosigned_by_definer: false,
										spender_attested: false,
									}
								},
								{
									app: 'state',
									state: `{
							$asset = $define_yes ? 'yes_asset' : 'no_asset';
							var[$asset] = response_unit;
							response[$asset] = response_unit;
						}`
								}
							]
						},
						{ // issue YES and NO assets in exchange for bytes
							if: "{trigger.output[[asset=base]] >= 1e5 AND var['yes_asset'] AND var['no_asset']}",
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{var['yes_asset']}",
										outputs: [
											{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
										]
									}
								},
								{
									app: 'payment',
									payload: {
										asset: "{var['no_asset']}",
										outputs: [
											{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
										]
									}
								},
							]
						},
						{ // record the outcome
							if: `{(trigger.data.winner == 'yes' OR trigger.data.winner == 'no') AND !var['winner']}`,
							messages: [{
								app: 'state',
								state: `{
						if (trigger.data.winner == 'yes' AND data_feed[[oracles='X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', feed_name='GBYTE_USD']] > 60)
							var['winner'] = 'yes';
						else if (trigger.data.winner == 'no' AND timestamp > 1556668800)
							var['winner'] = 'no';
						else
							bounce('suggested outcome not confirmed');
						response['winner'] = trigger.data.winner;
					}`
							}]
						},
						{ // pay bytes in exchange for the winning asset
							if: "{trigger.output[[asset!=base]] > 1000 AND var['winner'] AND trigger.output[[asset!=base]].asset == var[var['winner'] || '_asset']}",
							messages: [{
								app: 'payment',
								payload: {
									asset: "base",
									outputs: [
										{address: "{trigger.address}", amount: "{ trigger.output[[asset!=base]] }"}
									]
								}
							}]
						},
					]
				}
			}
		]
	)});
});

test('Futures contract', t => {
	var ojson = `{
	messages: {
		cases: [
			{ // define USD and GB assets
				if: \`{
					$define_usd = trigger.data.define_usd AND !var['usd_asset'];
					$define_gb = trigger.data.define_gb AND !var['gb_asset'];
					if ($define_usd AND $define_gb)
						bounce("can't define both assets at the same time");
					$define_usd OR $define_gb
				}\`,
				messages: [
					{
						app: 'asset',
						payload: {
							// without cap
							is_private: false,
							is_transferrable: true,
							auto_destroy: false,
							fixed_denominations: false,
							issued_by_definer_only: true,
							cosigned_by_definer: false,
							spender_attested: false,
						}
					},
					{
						app: 'state',
						state: \`{
							$asset = $define_usd ? 'usd_asset' : 'gb_asset';
							var[$asset] = response_unit;
							response[$asset] = response_unit;
						}\`
					}
				]
			},
			{ // issue USD and GB assets in exchange for bytes, it's ok to issue them even after expiry or blackswan
				if: "{trigger.output[[asset=base]] >= 1e5 AND var['usd_asset'] AND var['gb_asset']}",
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{var['usd_asset']}",
							outputs: [
								{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
							]
						}
					},
					{
						app: 'payment',
						payload: {
							asset: "{var['gb_asset']}",
							outputs: [
								{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
							]
						}
					},
				]
			},
			{ // record blackswan event
				if: \`{ trigger.data.blackswan AND !var['blackswan'] AND data_feed[[oracles='X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', feed_name='GBYTE_USD_MA']] < 25 AND timestamp < 1556668800 }\`,
				messages: [{
					app: 'state',
					state: \`{
						var['blackswan'] = 1;
						response['blackswan'] = 1;
					}\`
				}]
			},
			// 1 GB is now 50 USD, 1 byte is 50e-9 = 5e-8 USD
			// 1 usd asset is always 2.5e-8 USD, 1 gb asset is 1 byte minus 2.5e-8 USD
			{ // pay bytes in exchange for the assets
				if: \`{
					if (trigger.output[[asset!=base]].asset == 'none')
						return false;
					$gb_asset_amount = trigger.output[[asset=var['gb_asset']]];
					$usd_asset_amount = trigger.output[[asset=var['usd_asset']]];
					if ($gb_asset_amount < 1e4 AND $usd_asset_amount < 1e4)
						return false;
					if ($gb_asset_amount == $usd_asset_amount){ // helps in case the exchange rate is never posted
						$bytes = $gb_asset_amount;
						return true;
					}
					if (var['blackswan'])
						$bytes = $usd_asset_amount;
					else{
						if (timestamp < 1556668800)
							bounce('wait for maturity date');
						// data_feed will abort if the exchange rate not posted yet
						$exchange_rate = data_feed[[oracles='X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', feed_name='GBYTE_USD_MA_2019_04_30']];
						$bytes_per_usd_asset = min(50/$exchange_rate/2, 1);
						$bytes_per_gb_asset = 1 - $bytes_per_usd_asset;
						$bytes = round($bytes_per_usd_asset * $usd_asset_amount + $bytes_per_gb_asset * $gb_asset_amount);
					}
					true
				}\`,
				messages: [{
					app: 'payment',
					payload: {
						asset: "base",
						outputs: [
							{address: "{trigger.address}", amount: "{ $bytes }"}
						]
					}
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: {
					cases: [
						{ // define USD and GB assets
							if: `{
					$define_usd = trigger.data.define_usd AND !var['usd_asset'];
					$define_gb = trigger.data.define_gb AND !var['gb_asset'];
					if ($define_usd AND $define_gb)
						bounce("can't define both assets at the same time");
					$define_usd OR $define_gb
				}`,
							messages: [
								{
									app: 'asset',
									payload: {
										// without cap
										is_private: false,
										is_transferrable: true,
										auto_destroy: false,
										fixed_denominations: false,
										issued_by_definer_only: true,
										cosigned_by_definer: false,
										spender_attested: false,
									}
								},
								{
									app: 'state',
									state: `{
							$asset = $define_usd ? 'usd_asset' : 'gb_asset';
							var[$asset] = response_unit;
							response[$asset] = response_unit;
						}`
								}
							]
						},
						{ // issue USD and GB assets in exchange for bytes, it's ok to issue them even after expiry or blackswan
							if: "{trigger.output[[asset=base]] >= 1e5 AND var['usd_asset'] AND var['gb_asset']}",
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{var['usd_asset']}",
										outputs: [
											{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
										]
									}
								},
								{
									app: 'payment',
									payload: {
										asset: "{var['gb_asset']}",
										outputs: [
											{address: "{trigger.address}", amount: "{ trigger.output[[asset=base]] }"}
										]
									}
								},
							]
						},
						{ // record blackswan event
							if: `{ trigger.data.blackswan AND !var['blackswan'] AND data_feed[[oracles='X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', feed_name='GBYTE_USD_MA']] < 25 AND timestamp < 1556668800 }`,
							messages: [{
								app: 'state',
								state: `{
						var['blackswan'] = 1;
						response['blackswan'] = 1;
					}`
							}]
						},
						// 1 GB is now 50 USD, 1 byte is 50e-9 = 5e-8 USD
						// 1 usd asset is always 2.5e-8 USD, 1 gb asset is 1 byte minus 2.5e-8 USD
						{ // pay bytes in exchange for the assets
							if: `{
					if (trigger.output[[asset!=base]].asset == 'none')
						return false;
					$gb_asset_amount = trigger.output[[asset=var['gb_asset']]];
					$usd_asset_amount = trigger.output[[asset=var['usd_asset']]];
					if ($gb_asset_amount < 1e4 AND $usd_asset_amount < 1e4)
						return false;
					if ($gb_asset_amount == $usd_asset_amount){ // helps in case the exchange rate is never posted
						$bytes = $gb_asset_amount;
						return true;
					}
					if (var['blackswan'])
						$bytes = $usd_asset_amount;
					else{
						if (timestamp < 1556668800)
							bounce('wait for maturity date');
						// data_feed will abort if the exchange rate not posted yet
						$exchange_rate = data_feed[[oracles='X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', feed_name='GBYTE_USD_MA_2019_04_30']];
						$bytes_per_usd_asset = min(50/$exchange_rate/2, 1);
						$bytes_per_gb_asset = 1 - $bytes_per_usd_asset;
						$bytes = round($bytes_per_usd_asset * $usd_asset_amount + $bytes_per_gb_asset * $gb_asset_amount);
					}
					true
				}`,
							messages: [{
								app: 'payment',
								payload: {
									asset: "base",
									outputs: [
										{address: "{trigger.address}", amount: "{ $bytes }"}
									]
								}
							}]
						},
					]
				}
			}
		]
	)});
});

test('Payment channels', t => {
	var ojson = `{
	init: \`{
		$close_timeout = 300;
		$addressA = '2QHG44PZLJWD2H7C5ZIWH4NZZVB6QCC7';
		$addressB = 'X55IWSNMHNDUIYKICDW3EOYAWHRUKANP';
		$bFromA = (trigger.address == $addressA);
		$bFromB = (trigger.address == $addressB);
		$bFromParties = ($bFromA OR $bFromB);
		if ($bFromParties)
			$party = $bFromA ? 'A' : 'B';
	}\`,
	messages: {
		cases: [
			{ // refill the AA
				if: \`{ $bFromParties AND trigger.output[[asset=base]] >= 1e5 }\`,
				messages: [
					{
						app: 'state',
						state: \`{
							if (var['close_initiated_by'])
								bounce('already closing');
							if (!var['period'])
								var['period'] = 1;
							$key = 'balance' || $party;
							var[$key] += trigger.output[[asset=base]];
							response[$key] = var[$key];
						}\`
					}
				]
			},
			{ // start closing
				if: \`{ $bFromParties AND trigger.data.close AND !var['close_initiated_by'] }\`,
				messages: [
					{
						app: 'state',
						state: \`{
							$transferredFromMe = trigger.data.transferredFromMe otherwise 0;
							if ($transferredFromMe < 0)
								bounce('bad amount spent by me: ' || $transferredFromMe);
							if (trigger.data.sentByPeer){
								if (trigger.data.sentByPeer.signed_message.channel != this_address)
									bounce('signed for another channel');
								if (trigger.data.sentByPeer.signed_message.period != var['period'])
									bounce('signed for a different period of this channel');
								if (!is_valid_signed_package(trigger.data.sentByPeer, $bFromB ? $addressA : $addressB))
									bounce('invalid signature by peer');
								$transferredFromPeer = trigger.data.sentByPeer.signed_message.amount_spent;
								if ($transferredFromPeer < 0)
									bounce('bad amount spent by peer: ' || $transferredFromPeer);
							}
							else
								$transferredFromPeer = 0;
							var['spentByA'] = $bFromA ? $transferredFromMe : $transferredFromPeer;
							var['spentByB'] = $bFromB ? $transferredFromMe : $transferredFromPeer;
							$finalBalanceA = var['balanceA'] - var['spentByA'] + var['spentByB'];
							$finalBalanceB = var['balanceB'] - var['spentByB'] + var['spentByA'];
							if ($finalBalanceA < 0 OR $finalBalanceB < 0)
								bounce('one of the balances would become negative');
							var['close_initiated_by'] = $party;
							var['close_start_ts'] = timestamp;
							response['close_start_ts'] = timestamp;
							response['finalBalanceA'] = $finalBalanceA;
							response['finalBalanceB'] = $finalBalanceB;
						}\`
					}
				]
			},
			{ // confirm closure
				if: \`{ trigger.data.confirm AND var['close_initiated_by'] }\`,
				init: \`{
					if (!($bFromParties AND var['close_initiated_by'] != $party OR timestamp > var['close_start_ts'] + $close_timeout))
						bounce('too early');
					$finalBalanceA = var['balanceA'] - var['spentByA'] + var['spentByB'];
					$finalBalanceB = var['balanceB'] - var['spentByB'] + var['spentByA'];
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: 'base',
							outputs: [
								// fees are paid by the larger party, its output is send-all
								// this party also collects the accumulated 10Kb bounce fees
								{ address: '{$addressA}', amount: "{ $finalBalanceA < $finalBalanceB ? $finalBalanceA : '' }" },
								{ address: '{$addressB}', amount: "{ $finalBalanceA >= $finalBalanceB ? $finalBalanceB : '' }" }
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['period'] += 1;
							var['close_initiated_by'] = false;
							var['close_start_ts'] = false;
							var['balanceA'] = false;
							var['balanceB'] = false;
							var['spentByA'] = false;
							var['spentByB'] = false;
						}\`
					}
				]
			},
			{ // fraud proof
				if: \`{ trigger.data.fraud_proof AND var['close_initiated_by'] AND trigger.data.sentByPeer }\`,
				init: \`{
					$bInitiatedByA = (var['close_initiated_by'] == 'A');
					if (trigger.data.sentByPeer.signed_message.channel != this_address)
						bounce('signed for another channel');
					if (trigger.data.sentByPeer.signed_message.period != var['period'])
						bounce('signed for a different period of this channel');
					if (!is_valid_signed_package(trigger.data.sentByPeer, $bInitiatedByA ? $addressA : $addressB))
						bounce('invalid signature by peer');
					$transferredFromPeer = trigger.data.sentByPeer.signed_message.amount_spent;
					if ($transferredFromPeer < 0)
						bounce('bad amount spent by peer: ' || $transferredFromPeer);
					$transferredFromPeerAsClaimedByPeer = var['spentBy' || ($bInitiatedByA ? 'A' : 'B')];
					if ($transferredFromPeer <= $transferredFromPeerAsClaimedByPeer)
						bounce("the peer didn't lie in his favor");
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: 'base',
							outputs: [
								// send all
								{ address: '{trigger.address}' }
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['period'] += 1;
							var['close_initiated_by'] = false;
							var['close_start_ts'] = false;
							var['balanceA'] = false;
							var['balanceB'] = false;
							var['spentByA'] = false;
							var['spentByB'] = false;
						}\`
					}
				]
			}
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$close_timeout = 300;
		$addressA = '2QHG44PZLJWD2H7C5ZIWH4NZZVB6QCC7';
		$addressB = 'X55IWSNMHNDUIYKICDW3EOYAWHRUKANP';
		$bFromA = (trigger.address == $addressA);
		$bFromB = (trigger.address == $addressB);
		$bFromParties = ($bFromA OR $bFromB);
		if ($bFromParties)
			$party = $bFromA ? 'A' : 'B';
	}`,
				messages: {
					cases: [
						{ // refill the AA
							if: `{ $bFromParties AND trigger.output[[asset=base]] >= 1e5 }`,
							messages: [
								{
									app: 'state',
									state: `{
							if (var['close_initiated_by'])
								bounce('already closing');
							if (!var['period'])
								var['period'] = 1;
							$key = 'balance' || $party;
							var[$key] += trigger.output[[asset=base]];
							response[$key] = var[$key];
						}`
								}
							]
						},
						{ // start closing
							if: `{ $bFromParties AND trigger.data.close AND !var['close_initiated_by'] }`,
							messages: [
								{
									app: 'state',
									state: `{
							$transferredFromMe = trigger.data.transferredFromMe otherwise 0;
							if ($transferredFromMe < 0)
								bounce('bad amount spent by me: ' || $transferredFromMe);
							if (trigger.data.sentByPeer){
								if (trigger.data.sentByPeer.signed_message.channel != this_address)
									bounce('signed for another channel');
								if (trigger.data.sentByPeer.signed_message.period != var['period'])
									bounce('signed for a different period of this channel');
								if (!is_valid_signed_package(trigger.data.sentByPeer, $bFromB ? $addressA : $addressB))
									bounce('invalid signature by peer');
								$transferredFromPeer = trigger.data.sentByPeer.signed_message.amount_spent;
								if ($transferredFromPeer < 0)
									bounce('bad amount spent by peer: ' || $transferredFromPeer);
							}
							else
								$transferredFromPeer = 0;
							var['spentByA'] = $bFromA ? $transferredFromMe : $transferredFromPeer;
							var['spentByB'] = $bFromB ? $transferredFromMe : $transferredFromPeer;
							$finalBalanceA = var['balanceA'] - var['spentByA'] + var['spentByB'];
							$finalBalanceB = var['balanceB'] - var['spentByB'] + var['spentByA'];
							if ($finalBalanceA < 0 OR $finalBalanceB < 0)
								bounce('one of the balances would become negative');
							var['close_initiated_by'] = $party;
							var['close_start_ts'] = timestamp;
							response['close_start_ts'] = timestamp;
							response['finalBalanceA'] = $finalBalanceA;
							response['finalBalanceB'] = $finalBalanceB;
						}`
								}
							]
						},
						{ // confirm closure
							if: `{ trigger.data.confirm AND var['close_initiated_by'] }`,
							init: `{
					if (!($bFromParties AND var['close_initiated_by'] != $party OR timestamp > var['close_start_ts'] + $close_timeout))
						bounce('too early');
					$finalBalanceA = var['balanceA'] - var['spentByA'] + var['spentByB'];
					$finalBalanceB = var['balanceB'] - var['spentByB'] + var['spentByA'];
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: 'base',
										outputs: [
											// fees are paid by the larger party, its output is send-all
											// this party also collects the accumulated 10Kb bounce fees
											{ address: '{$addressA}', amount: "{ $finalBalanceA < $finalBalanceB ? $finalBalanceA : '' }" },
											{ address: '{$addressB}', amount: "{ $finalBalanceA >= $finalBalanceB ? $finalBalanceB : '' }" }
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['period'] += 1;
							var['close_initiated_by'] = false;
							var['close_start_ts'] = false;
							var['balanceA'] = false;
							var['balanceB'] = false;
							var['spentByA'] = false;
							var['spentByB'] = false;
						}`
								}
							]
						},
						{ // fraud proof
							if: `{ trigger.data.fraud_proof AND var['close_initiated_by'] AND trigger.data.sentByPeer }`,
							init: `{
					$bInitiatedByA = (var['close_initiated_by'] == 'A');
					if (trigger.data.sentByPeer.signed_message.channel != this_address)
						bounce('signed for another channel');
					if (trigger.data.sentByPeer.signed_message.period != var['period'])
						bounce('signed for a different period of this channel');
					if (!is_valid_signed_package(trigger.data.sentByPeer, $bInitiatedByA ? $addressA : $addressB))
						bounce('invalid signature by peer');
					$transferredFromPeer = trigger.data.sentByPeer.signed_message.amount_spent;
					if ($transferredFromPeer < 0)
						bounce('bad amount spent by peer: ' || $transferredFromPeer);
					$transferredFromPeerAsClaimedByPeer = var['spentBy' || ($bInitiatedByA ? 'A' : 'B')];
					if ($transferredFromPeer <= $transferredFromPeerAsClaimedByPeer)
						bounce("the peer didn't lie in his favor");
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: 'base',
										outputs: [
											// send all
											{ address: '{trigger.address}' }
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['period'] += 1;
							var['close_initiated_by'] = false;
							var['close_start_ts'] = false;
							var['balanceA'] = false;
							var['balanceB'] = false;
							var['spentByA'] = false;
							var['spentByB'] = false;
						}`
								}
							]
						}
					]
				}
			}
		]
	)});
});

test('Order book exchange', t => {
	var ojson = `{
	messages: {
		cases: [
			{ // withdraw funds
				if: \`{
					$key = 'balance_'||trigger.address||'_'||trigger.data.asset;
					trigger.data.withdraw AND trigger.data.asset AND trigger.data.amount AND trigger.data.amount <= var[$key]
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{trigger.data.asset}",
							outputs: [
								{address: "{trigger.address}", amount: "{trigger.data.amount}"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var[$key] = var[$key] - trigger.data.amount;
						}\`
					}
				]
			},
			{ // execute orders, order1 must be smaller or the same as order2; order2 is partially filled
				if: \`{
					$order1 = trigger.data.order1.signed_message;
					$order2 = trigger.data.order2.signed_message;
					if (!$order1.sell_asset OR !$order2.sell_asset)
						return false;
					if ($order1.sell_asset != $order2.buy_asset OR $order1.buy_asset != $order2.sell_asset)
						return false;

					// to do check expiry

					$sell_key1 = 'balance_' || $order1.address || '_' || $order1.sell_asset;
					$sell_key2 = 'balance_' || $order2.address || '_' || $order2.sell_asset;

					$id1 = sha256($order1.address || $order1.sell_asset || $order1.buy_asset || $order1.sell_amount || $order1.price || trigger.data.order1.last_ball_unit);
					$id2 = sha256($order2.address || $order2.sell_asset || $order2.buy_asset || $order2.sell_amount || $order2.price || trigger.data.order2.last_ball_unit);

					if (var['executed_' || $id1] OR var['executed_' || $id2])
						return false;

					if (!is_valid_signed_package(trigger.data.order1, $order1.address)
						OR !is_valid_signed_package(trigger.data.order2, $order2.address))
						return false;

					$amount_left1 = var['amount_left_' || $id1] otherwise $order1.sell_amount;
					$amount_left2 = var['amount_left_' || $id2] otherwise $order2.sell_amount;

					if ($amount_left1 > var[$sell_key1] OR $amount_left2 > var[$sell_key2])
						return false;

					$buy_amount1 = round($amount_left1 * $order1.price);
					if ($buy_amount1 > $amount_left2) // order1 is not the smaller one
						return false;
					$expected_buy_amount2 = round($buy_amount1 * $order2.price);
					if ($expected_buy_amount2 > $amount_left1) // user2 doesn't like the price, he gets less than expects
						return false;

					true
				}\`,
				messages: [{
					app: 'state',
					state: \`{
						$buy_key1 = 'balance_' || $order1.address || '_' || $order1.buy_asset;
						$buy_key2 = 'balance_' || $order2.address || '_' || $order2.buy_asset;
						$base_key1 = 'balance_' || $order1.address || '_base';
						$base_key2 = 'balance_' || $order2.address || '_base';

						var[$sell_key1] = var[$sell_key1] - $amount_left1;
						var[$sell_key2] = var[$sell_key2] - $buy_amount1;
						var[$buy_key1] = var[$buy_key1] + $buy_amount1;
						var[$buy_key2] = var[$buy_key2] + $amount_left1;

						$fee = 1000;
						var[$base_key1] = var[$base_key1] - $fee;
						var[$base_key2] = var[$base_key2] - $fee;
						if (var[$base_key1] < 0 OR var[$base_key2] < 0)
							bounce('not enough balance for fees');

						var['executed_' || $id1] = 1;
						$new_amount_left2 = $amount_left2 - $buy_amount1;
						if ($new_amount_left2)
							var['amount_left_' || $id2] = $new_amount_left2;
						else
							var['executed_' || $id2] = 1;

						// parsable response for transaction log
						response[$order1.address || '_' || $order1.sell_asset] = -$amount_left1;
						response[$order2.address || '_' || $order2.buy_asset] = $amount_left1;
						response[$order1.address || '_' || $order1.buy_asset] = $buy_amount1;
						response[$order2.address || '_' || $order2.sell_asset] = -$buy_amount1;
					}\`
				}]
			},
			{ // silently accept coins
				if: "{!trigger.data}",
				messages: [{
					app: 'state',
					state: \`{
						$asset = trigger.output[[asset!=base]].asset;
						if ($asset == 'ambiguous')
							bounce('ambiguous asset');
						if (trigger.output[[asset=base]] > 10000){
							$base_key = 'balance_'||trigger.address||'_'||'base';
							var[$base_key] = var[$base_key] + trigger.output[[asset=base]];
							$response_base = trigger.output[[asset=base]] || ' bytes\\n';
						}
						if ($asset != 'none'){
							$asset_key = 'balance_'||trigger.address||'_'||$asset;
							var[$asset_key] = var[$asset_key] + trigger.output[[asset=$asset]];
							$response_asset = trigger.output[[asset=$asset]] || ' of ' || $asset || '\\n';
						}
						response['message'] = 'accepted coins:\\n' || ($response_base otherwise '') || ($response_asset otherwise '');
					}\`
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: {
					cases: [
						{ // withdraw funds
							if: `{
					$key = 'balance_'||trigger.address||'_'||trigger.data.asset;
					trigger.data.withdraw AND trigger.data.asset AND trigger.data.amount AND trigger.data.amount <= var[$key]
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{trigger.data.asset}",
										outputs: [
											{address: "{trigger.address}", amount: "{trigger.data.amount}"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							var[$key] = var[$key] - trigger.data.amount;
						}`
								}
							]
						},
						{ // execute orders, order1 must be smaller or the same as order2; order2 is partially filled
							if: `{
					$order1 = trigger.data.order1.signed_message;
					$order2 = trigger.data.order2.signed_message;
					if (!$order1.sell_asset OR !$order2.sell_asset)
						return false;
					if ($order1.sell_asset != $order2.buy_asset OR $order1.buy_asset != $order2.sell_asset)
						return false;

					// to do check expiry

					$sell_key1 = 'balance_' || $order1.address || '_' || $order1.sell_asset;
					$sell_key2 = 'balance_' || $order2.address || '_' || $order2.sell_asset;

					$id1 = sha256($order1.address || $order1.sell_asset || $order1.buy_asset || $order1.sell_amount || $order1.price || trigger.data.order1.last_ball_unit);
					$id2 = sha256($order2.address || $order2.sell_asset || $order2.buy_asset || $order2.sell_amount || $order2.price || trigger.data.order2.last_ball_unit);

					if (var['executed_' || $id1] OR var['executed_' || $id2])
						return false;

					if (!is_valid_signed_package(trigger.data.order1, $order1.address)
						OR !is_valid_signed_package(trigger.data.order2, $order2.address))
						return false;

					$amount_left1 = var['amount_left_' || $id1] otherwise $order1.sell_amount;
					$amount_left2 = var['amount_left_' || $id2] otherwise $order2.sell_amount;

					if ($amount_left1 > var[$sell_key1] OR $amount_left2 > var[$sell_key2])
						return false;

					$buy_amount1 = round($amount_left1 * $order1.price);
					if ($buy_amount1 > $amount_left2) // order1 is not the smaller one
						return false;
					$expected_buy_amount2 = round($buy_amount1 * $order2.price);
					if ($expected_buy_amount2 > $amount_left1) // user2 doesn't like the price, he gets less than expects
						return false;

					true
				}`,
							messages: [{
								app: 'state',
								state: `{
						$buy_key1 = 'balance_' || $order1.address || '_' || $order1.buy_asset;
						$buy_key2 = 'balance_' || $order2.address || '_' || $order2.buy_asset;
						$base_key1 = 'balance_' || $order1.address || '_base';
						$base_key2 = 'balance_' || $order2.address || '_base';

						var[$sell_key1] = var[$sell_key1] - $amount_left1;
						var[$sell_key2] = var[$sell_key2] - $buy_amount1;
						var[$buy_key1] = var[$buy_key1] + $buy_amount1;
						var[$buy_key2] = var[$buy_key2] + $amount_left1;

						$fee = 1000;
						var[$base_key1] = var[$base_key1] - $fee;
						var[$base_key2] = var[$base_key2] - $fee;
						if (var[$base_key1] < 0 OR var[$base_key2] < 0)
							bounce('not enough balance for fees');

						var['executed_' || $id1] = 1;
						$new_amount_left2 = $amount_left2 - $buy_amount1;
						if ($new_amount_left2)
							var['amount_left_' || $id2] = $new_amount_left2;
						else
							var['executed_' || $id2] = 1;

						// parsable response for transaction log
						response[$order1.address || '_' || $order1.sell_asset] = -$amount_left1;
						response[$order2.address || '_' || $order2.buy_asset] = $amount_left1;
						response[$order1.address || '_' || $order1.buy_asset] = $buy_amount1;
						response[$order2.address || '_' || $order2.sell_asset] = -$buy_amount1;
					}`
							}]
						},
						{ // silently accept coins
							if: "{!trigger.data}",
							messages: [{
								app: 'state',
								state: `{
						$asset = trigger.output[[asset!=base]].asset;
						if ($asset == 'ambiguous')
							bounce('ambiguous asset');
						if (trigger.output[[asset=base]] > 10000){
							$base_key = 'balance_'||trigger.address||'_'||'base';
							var[$base_key] = var[$base_key] + trigger.output[[asset=base]];
							$response_base = trigger.output[[asset=base]] || ' bytes\\n';
						}
						if ($asset != 'none'){
							$asset_key = 'balance_'||trigger.address||'_'||$asset;
							var[$asset_key] = var[$asset_key] + trigger.output[[asset=$asset]];
							$response_asset = trigger.output[[asset=$asset]] || ' of ' || $asset || '\\n';
						}
						response['message'] = 'accepted coins:\\n' || ($response_base otherwise '') || ($response_asset otherwise '');
					}`
							}]
						},
					]
				}
			}
		]
	)});
});

test('Uniswap-like market maker', t => {
	var ojson = `{
	init: \`{
		$asset = 'n9y3VomFeWFeZZ2PcSEcmyBb/bI7kzZduBJigNetnkY=';
		$mm_asset = var['mm_asset'];
	}\`,
	messages: {
		cases: [
			{ // define share asset
				if: \`{ trigger.data.define AND !$mm_asset }\`,
				messages: [
					{
						app: 'asset',
						payload: {
							// without cap
							is_private: false,
							is_transferrable: true,
							auto_destroy: false,
							fixed_denominations: false,
							issued_by_definer_only: true,
							cosigned_by_definer: false,
							spender_attested: false,
						}
					},
					{
						app: 'state',
						state: \`{
							var['mm_asset'] = response_unit;
							response['mm_asset'] = response_unit;
						}\`
					}
				]
			},
			{ // invest in MM
				if: \`{$mm_asset AND trigger.output[[asset=base]] > 1e5 AND trigger.output[[asset=$asset]] > 0}\`,
				init: \`{
					$asset_balance = balance[$asset] - trigger.output[[asset=$asset]];
					$bytes_balance = balance[base] - trigger.output[[asset=base]];
					if ($asset_balance == 0 OR $bytes_balance == 0){ // initial deposit
						$issue_amount = balance[base];
						return;
					}
					$current_ratio = $asset_balance / $bytes_balance;
					$expected_asset_amount = round($current_ratio * trigger.output[[asset=base]]);
					if ($expected_asset_amount != trigger.output[[asset=$asset]])
						bounce('wrong ratio of amounts, expected ' || $expected_asset_amount || ' of asset');
					$investor_share_of_prev_balance = trigger.output[[asset=base]] / $bytes_balance;
					$issue_amount = round($investor_share_of_prev_balance * var['mm_asset_outstanding']);
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{$mm_asset}",
							outputs: [
								{address: "{trigger.address}", amount: "{ $issue_amount }"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['mm_asset_outstanding'] += $issue_amount;
						}\`
					},
				]
			},
			{ // divest MM shares
				// (user is already paying 10000 bytes bounce fee which is a divest fee)
				// the price slightly moves due to fees received and paid in bytes
				if: \`{$mm_asset AND trigger.output[[asset=$mm_asset]]}\`,
				init: \`{
					$mm_asset_amount = trigger.output[[asset=$mm_asset]];
					$investor_share = $mm_asset_amount / var['mm_asset_outstanding'];
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{$asset}",
							outputs: [
								{address: "{trigger.address}", amount: "{ round($investor_share * balance[$asset]) }"}
							]
						}
					},
					{
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [
								{address: "{trigger.address}", amount: "{ round($investor_share * balance[base]) }"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['mm_asset_outstanding'] -= trigger.output[[asset=$mm_asset]];
						}\`
					},
				]
			},
			{ // exchange bytes to asset
				if: \`{trigger.output[[asset=base]] > 1e5 AND trigger.output[[asset=$asset]] == 0 AND var['mm_asset_outstanding']}\`,
				init: \`{
					$asset_balance = balance[$asset] - trigger.output[[asset=$asset]];
					$bytes_balance = balance[base] - trigger.output[[asset=base]];
					// other formula can be used for product, e.g. $asset_balance * $bytes_balance ^ 2
					$p = $asset_balance * $bytes_balance;
					$new_asset_balance = round($p / balance[base]);
					$amount = $asset_balance - $new_asset_balance; // we can deduct exchange fees here
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{$asset}",
							outputs: [
								{address: "{trigger.address}", amount: "{ $amount }"}
							]
						}
					},
				]
			},
			{ // exchange asset to bytes
				if: \`{trigger.output[[asset=$asset]] > 0 AND var['mm_asset_outstanding']}\`,
				init: \`{
					$asset_balance = balance[$asset] - trigger.output[[asset=$asset]];
					$bytes_balance = balance[base] - trigger.output[[asset=base]]; // 10Kb fee
					// other formula can be used for product, e.g. $asset_balance * $bytes_balance ^ 2
					$p = $asset_balance * $bytes_balance;
					$new_bytes_balance = round($p / balance[$asset]);
					$amount = $bytes_balance - $new_bytes_balance; // we can deduct exchange fees here
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [
								{address: "{trigger.address}", amount: "{ $amount }"}
							]
						}
					},
				]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$asset = 'n9y3VomFeWFeZZ2PcSEcmyBb/bI7kzZduBJigNetnkY=';
		$mm_asset = var['mm_asset'];
	}`,
				messages: {
					cases: [
						{ // define share asset
							if: `{ trigger.data.define AND !$mm_asset }`,
							messages: [
								{
									app: 'asset',
									payload: {
										// without cap
										is_private: false,
										is_transferrable: true,
										auto_destroy: false,
										fixed_denominations: false,
										issued_by_definer_only: true,
										cosigned_by_definer: false,
										spender_attested: false,
									}
								},
								{
									app: 'state',
									state: `{
							var['mm_asset'] = response_unit;
							response['mm_asset'] = response_unit;
						}`
								}
							]
						},
						{ // invest in MM
							if: `{$mm_asset AND trigger.output[[asset=base]] > 1e5 AND trigger.output[[asset=$asset]] > 0}`,
							init: `{
					$asset_balance = balance[$asset] - trigger.output[[asset=$asset]];
					$bytes_balance = balance[base] - trigger.output[[asset=base]];
					if ($asset_balance == 0 OR $bytes_balance == 0){ // initial deposit
						$issue_amount = balance[base];
						return;
					}
					$current_ratio = $asset_balance / $bytes_balance;
					$expected_asset_amount = round($current_ratio * trigger.output[[asset=base]]);
					if ($expected_asset_amount != trigger.output[[asset=$asset]])
						bounce('wrong ratio of amounts, expected ' || $expected_asset_amount || ' of asset');
					$investor_share_of_prev_balance = trigger.output[[asset=base]] / $bytes_balance;
					$issue_amount = round($investor_share_of_prev_balance * var['mm_asset_outstanding']);
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{$mm_asset}",
										outputs: [
											{address: "{trigger.address}", amount: "{ $issue_amount }"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['mm_asset_outstanding'] += $issue_amount;
						}`
								},
							]
						},
						{ // divest MM shares
							// (user is already paying 10000 bytes bounce fee which is a divest fee)
							// the price slightly moves due to fees received and paid in bytes
							if: `{$mm_asset AND trigger.output[[asset=$mm_asset]]}`,
							init: `{
					$mm_asset_amount = trigger.output[[asset=$mm_asset]];
					$investor_share = $mm_asset_amount / var['mm_asset_outstanding'];
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{$asset}",
										outputs: [
											{address: "{trigger.address}", amount: "{ round($investor_share * balance[$asset]) }"}
										]
									}
								},
								{
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [
											{address: "{trigger.address}", amount: "{ round($investor_share * balance[base]) }"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['mm_asset_outstanding'] -= trigger.output[[asset=$mm_asset]];
						}`
								},
							]
						},
						{ // exchange bytes to asset
							if: `{trigger.output[[asset=base]] > 1e5 AND trigger.output[[asset=$asset]] == 0 AND var['mm_asset_outstanding']}`,
							init: `{
					$asset_balance = balance[$asset] - trigger.output[[asset=$asset]];
					$bytes_balance = balance[base] - trigger.output[[asset=base]];
					// other formula can be used for product, e.g. $asset_balance * $bytes_balance ^ 2
					$p = $asset_balance * $bytes_balance;
					$new_asset_balance = round($p / balance[base]);
					$amount = $asset_balance - $new_asset_balance; // we can deduct exchange fees here
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{$asset}",
										outputs: [
											{address: "{trigger.address}", amount: "{ $amount }"}
										]
									}
								},
							]
						},
						{ // exchange asset to bytes
							if: `{trigger.output[[asset=$asset]] > 0 AND var['mm_asset_outstanding']}`,
							init: `{
					$asset_balance = balance[$asset] - trigger.output[[asset=$asset]];
					$bytes_balance = balance[base] - trigger.output[[asset=base]]; // 10Kb fee
					// other formula can be used for product, e.g. $asset_balance * $bytes_balance ^ 2
					$p = $asset_balance * $bytes_balance;
					$new_bytes_balance = round($p / balance[$asset]);
					$amount = $bytes_balance - $new_bytes_balance; // we can deduct exchange fees here
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [
											{address: "{trigger.address}", amount: "{ $amount }"}
										]
									}
								},
							]
						},
					]
				}
			}
		]
	)});
});

test('Send all', t => {
	var ojson = `{
	messages: {
		cases: [
			{
				if: \`{trigger.output[[asset=base]] >= 1e6}\`,
				messages: [{
					app: 'payment',
					payload: {
						asset: 'base',
						outputs: [
							{ address: '{trigger.address}' }
						]
					}
				}]
			},
			{
				messages: [{
					app: 'payment',
					payload: {
						asset: 'base',
						outputs: [
							{ address: 'X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', amount: \`{round(trigger.output[[asset=base]]/2)}\` },
							{ address: '{trigger.address}' }, // no amount here meaning that this output receives all the remaining coins
						]
					}
				}]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: {
					cases: [
						{
							if: `{trigger.output[[asset=base]] >= 1e6}`,
							messages: [{
								app: 'payment',
								payload: {
									asset: 'base',
									outputs: [
										{ address: '{trigger.address}' }
									]
								}
							}]
						},
						{
							messages: [{
								app: 'payment',
								payload: {
									asset: 'base',
									outputs: [
										{ address: 'X55IWSNMHNDUIYKICDW3EOYAWHRUKANP', amount: `{round(trigger.output[[asset=base]]/2)}` },
										{ address: '{trigger.address}' }, // no amount here meaning that this output receives all the remaining coins
									]
								}
							}]
						},
					]
				}
			}
		]
	)});
});

test('Sending prepared objects through trigger.data', t => {
	var ojson = `{
	messages: [
		{
			if: \`{trigger.data.d}\`,
			app: 'data',
			payload: \`{trigger.data.d}\`
		},
		{
			if: \`{trigger.data.sub}\`,
			app: 'data',
			payload: {
				xx: 66.3,
				sub: \`{trigger.data.sub}\`
			}
		},
		{
			if: \`{trigger.data.output}\`,
			app: 'payment',
			payload: {
				asset: "base",
				outputs: [
					\`{trigger.data.output}\`
				]
			}
		},
		{
			if: \`{trigger.data.payment}\`,
			app: 'payment',
			payload: \`{trigger.data.payment}\`
		},
	]
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				messages: [
					{
						if: `{trigger.data.d}`,
						app: 'data',
						payload: `{trigger.data.d}`
					},
					{
						if: `{trigger.data.sub}`,
						app: 'data',
						payload: {
							xx: 66.3,
							sub: `{trigger.data.sub}`
						}
					},
					{
						if: `{trigger.data.output}`,
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [
								`{trigger.data.output}`
							]
						}
					},
					{
						if: `{trigger.data.payment}`,
						app: 'payment',
						payload: `{trigger.data.payment}`
					},
				]
			}
		]
	)});
});

test('51% attack game', t => {
	var ojson = `{
	/*
	This is a 51% attack game.

	Several teams are competing to collect at least 51% of all contributions. The contributors of the winning team will divide all collected funds amongst themselves, thus making up to 2x profit.

	Contributors receive shares of their team in exchange for Bytes. Shares can be freely traded.

	As soon as any team reaches 51%, it stops accepting new contributions and a 1-day challenging period starts.  During the challenging period, other teams continue collecting contributions and if any of them reaches 51%, the challenging period restarts with the new candidate winner.

	If the challenging period expires without change of candidate winner, the candidate winner team becomes the winner.  Contributors of the winner team can exchange their shares back to Bytes (with a profit).  The winnings are distributed in proportion to the contributions, minus the founder tax.

	Anyone can create a new team.  The team founder can set a tax: a % that all his followers will pay to him if his team wins.

	While trying to challenge the candidate winner, the contender teams can use fundraising proxy AA which makes sure that the raised funds will be sent to the game only if 51% is actually attained, otherwise the funds can be safely refunded.
	*/

	init: \`{
		$team_creation_fee = 5000;
		$challenging_period = 24*3600;
		$bFinished = var['finished'];
	}\`,
	messages: {
		cases: [
			{ // create a new team; any excess amount is sent back
				if: \`{trigger.data.create_team AND !$bFinished}\`,
				init: \`{
					if (var['team_' || trigger.address || '_amount'])
						bounce('you already have a team');
					if (trigger.output[[asset=base]] < $team_creation_fee)
						bounce('not enough to pay for team creation');
				}\`,
				messages: [
					{
						app: 'asset',
						payload: {
							is_private: false,
							is_transferrable: true,
							auto_destroy: false,
							fixed_denominations: false,
							issued_by_definer_only: true,
							cosigned_by_definer: false,
							spender_attested: false
						}
					},
					{
						app: 'payment',
						if: \`{trigger.output[[asset=base]] > $team_creation_fee}\`,
						payload: {
							asset: 'base',
							outputs: [
								{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - $team_creation_fee}"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['team_' || trigger.address || '_founder_tax'] = trigger.data.founder_tax otherwise 0;
							var['team_' || trigger.address || '_asset'] = response_unit;
							response['team_asset'] = response_unit;
						}\`
					}
				]
			},
			{ // contribute to a team
				if: \`{trigger.data.team AND !$bFinished}\`,
				init: \`{
					if (!var['team_' || trigger.data.team || '_asset'])
						bounce('no such team');
					if (var['winner'] AND var['winner'] == trigger.data.team)
						bounce('contributions to candidate winner team are not allowed');
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: \`{var['team_' || trigger.data.team || '_asset']}\`,
							outputs: [
								{address: "{trigger.address}", amount: "{trigger.output[[asset=base]]}"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['team_' || trigger.data.team || '_amount'] += trigger.output[[asset=base]];
							if (var['team_' || trigger.data.team || '_amount'] > balance[base]*0.51){
								var['winner'] = trigger.data.team;
								var['challenging_period_start_ts'] = timestamp;
							}
						}\`
					}
				]
			},
			{ // finish the challenging period and set the winner
				if: \`{trigger.data.finish AND !$bFinished}\`,
				init: \`{
					if (!var['winner'])
						bounce('no candidate winner yet');
					if (timestamp < var['challenging_period_start_ts'] + $challenging_period)
						bounce('challenging period not expired yet');
				}\`,
				messages: [
					{
						app: 'state',
						state: \`{
							var['finished'] = 1;
							var['total'] = balance[base];
							var['challenging_period_start_ts'] = false;
							response['winner'] = var['winner'];
						}\`
					}
				]
			},
			{ // pay out the winnings
				if: \`{
					if (!$bFinished)
						return false;
					$winner = var['winner'];
					$winner_asset = var['team_' || $winner || '_asset'];
					$asset_amount = trigger.output[[asset=$winner_asset]];
					$asset_amount > 0
				}\`,
				init: \`{
					$share = $asset_amount / var['team_' || $winner || '_amount'];
					$founder_tax = var['team_' || $winner || '_founder_tax'];
					$amount = round(( $share * (1-$founder_tax) + (trigger.address == $winner AND !var['founder_tax_paid'] ? $founder_tax : 0) ) * var['total']);
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [
								{address: "{trigger.address}", amount: "{$amount}"}
							]
						}
					},
					{
						app: 'state',
						state: \`{
							if (trigger.address == $winner)
								var['founder_tax_paid'] = 1;
						}\`
					}
				]
			}
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$team_creation_fee = 5000;
		$challenging_period = 24*3600;
		$bFinished = var['finished'];
	}`,
				messages: {
					cases: [
						{ // create a new team; any excess amount is sent back
							if: `{trigger.data.create_team AND !$bFinished}`,
							init: `{
					if (var['team_' || trigger.address || '_amount'])
						bounce('you already have a team');
					if (trigger.output[[asset=base]] < $team_creation_fee)
						bounce('not enough to pay for team creation');
				}`,
							messages: [
								{
									app: 'asset',
									payload: {
										is_private: false,
										is_transferrable: true,
										auto_destroy: false,
										fixed_denominations: false,
										issued_by_definer_only: true,
										cosigned_by_definer: false,
										spender_attested: false
									}
								},
								{
									app: 'payment',
									if: `{trigger.output[[asset=base]] > $team_creation_fee}`,
									payload: {
										asset: 'base',
										outputs: [
											{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - $team_creation_fee}"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['team_' || trigger.address || '_founder_tax'] = trigger.data.founder_tax otherwise 0;
							var['team_' || trigger.address || '_asset'] = response_unit;
							response['team_asset'] = response_unit;
						}`
								}
							]
						},
						{ // contribute to a team
							if: `{trigger.data.team AND !$bFinished}`,
							init: `{
					if (!var['team_' || trigger.data.team || '_asset'])
						bounce('no such team');
					if (var['winner'] AND var['winner'] == trigger.data.team)
						bounce('contributions to candidate winner team are not allowed');
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: `{var['team_' || trigger.data.team || '_asset']}`,
										outputs: [
											{address: "{trigger.address}", amount: "{trigger.output[[asset=base]]}"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['team_' || trigger.data.team || '_amount'] += trigger.output[[asset=base]];
							if (var['team_' || trigger.data.team || '_amount'] > balance[base]*0.51){
								var['winner'] = trigger.data.team;
								var['challenging_period_start_ts'] = timestamp;
							}
						}`
								}
							]
						},
						{ // finish the challenging period and set the winner
							if: `{trigger.data.finish AND !$bFinished}`,
							init: `{
					if (!var['winner'])
						bounce('no candidate winner yet');
					if (timestamp < var['challenging_period_start_ts'] + $challenging_period)
						bounce('challenging period not expired yet');
				}`,
							messages: [
								{
									app: 'state',
									state: `{
							var['finished'] = 1;
							var['total'] = balance[base];
							var['challenging_period_start_ts'] = false;
							response['winner'] = var['winner'];
						}`
								}
							]
						},
						{ // pay out the winnings
							if: `{
					if (!$bFinished)
						return false;
					$winner = var['winner'];
					$winner_asset = var['team_' || $winner || '_asset'];
					$asset_amount = trigger.output[[asset=$winner_asset]];
					$asset_amount > 0
				}`,
							init: `{
					$share = $asset_amount / var['team_' || $winner || '_amount'];
					$founder_tax = var['team_' || $winner || '_founder_tax'];
					$amount = round(( $share * (1-$founder_tax) + (trigger.address == $winner AND !var['founder_tax_paid'] ? $founder_tax : 0) ) * var['total']);
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [
											{address: "{trigger.address}", amount: "{$amount}"}
										]
									}
								},
								{
									app: 'state',
									state: `{
							if (trigger.address == $winner)
								var['founder_tax_paid'] = 1;
						}`
								}
							]
						}
					]
				}
			}
		]
	)});
});

test('Fundraising proxy', t => {
	var ojson = `{
	/*
	This is a fundraising proxy AA.

	It allows to raise money up to a specific target.  If the target is reached, the money is forwarded to another AA, otherwise the money is refunded.

	This specific example raises money for challenging the current candidate winner in 51% attack game.  The target is a moving target as other teams may be adding contributions at the same time.

	Contributors get shares of the proxy in exchange for Bytes.  They can exchange the shares back to the same amount of Bytes any time before the target is reached.  As soon as the target is reached, the raised funds are forwarded to the game and the proxy receives the shares of the team in exchange.  Then, the contributors can exchange the shares of the proxy for the shares of the team.
	*/

	init: \`{
		$asset = var['asset'];
		$destination_aa = 'WWHEN5NDHBI2UF4CLJ7LQ7VAW2QELMD7';
		$team = 'VF5UVKDSOXPMITMDGYXEIGUJSQBRAMMN';
	}\`,
	messages: {
		cases: [
			{ // start a new fundraising period
				if: \`{trigger.data.start AND !$asset}\`,
				messages: [
					{
						app: 'asset',
						payload: {
							is_private: false,
							is_transferrable: true,
							auto_destroy: false,
							fixed_denominations: false,
							issued_by_definer_only: true,
							cosigned_by_definer: false,
							spender_attested: false
						}
					},
					{
						app: 'state',
						state: \`{
							var[response_unit || '_status'] = 'open';
							var['asset'] = response_unit;
							response['asset'] = response_unit;
						}\`
					}
				]
			},
			{ // contribute
				if: \`{trigger.output[[asset=base]] >= 1e5 AND $asset}\`,
				init: \`{
					if (var[$destination_aa]['finished'])
						bounce('game over');
					$amount = trigger.output[[asset=base]] - 2000; // to account for fees we need to respond now and to refund bytes or pay shares later
					$total_raised = var['total_raised'] + $amount;
					$missing_amount = ceil((balance[$destination_aa][base] + $total_raised)*0.51) - var[$destination_aa]['team_' || $team || '_amount'];
					$bDone = ($total_raised > $missing_amount);
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{$asset}",
							outputs: [{address: "{trigger.address}", amount: "{$amount}"}]
						}
					},
					{
						if: \`{$bDone}\`,
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [{address: "{$destination_aa}", amount: "{$total_raised}"}]
						}
					},
					{
						if: \`{$bDone}\`,
						app: 'data',
						payload: {
							team: "{$team}"
						}
					},
					{
						app: 'state',
						state: \`{
							if ($bDone)
								var[$asset || '_status'] = 'raised';
							else
								var['total_raised'] = $total_raised;
						}\`
					}
				]
			},
			{ // received team asset
				if: \`{trigger.output[[asset=var[$destination_aa]['team_' || $team || '_asset']]] AND $asset}\`,
				messages: [
					{
						app: 'state',
						state: \`{
							var[$asset || '_status'] = 'done';
							var['asset'] = false;
							var['total_raised'] = false;
						}\`
					}
				]
			},
			{ // refund
				if: \`{$asset AND trigger.output[[asset=$asset]] > 0}\`,
				init: \`{
					$amount = trigger.output[[asset=$asset]];
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [{address: "{trigger.address}", amount: "{$amount}"}]
						}
					},
					{
						app: 'state',
						state: \`{
							var['total_raised'] -= $amount;
						}\`
					}
				]
			},
			{ // pay the obtained team asset in exchange for the issued asset
				if: \`{
					$in_asset = trigger.output[[asset!=base]].asset;
					var[$in_asset || '_status'] == 'done'
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{var[$destination_aa]['team_' || $team || '_asset']}",
							outputs: [{address: "{trigger.address}", amount: "{trigger.output[[asset=$in_asset]]}"}]
						}
					},
				]
			}
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$asset = var['asset'];
		$destination_aa = 'WWHEN5NDHBI2UF4CLJ7LQ7VAW2QELMD7';
		$team = 'VF5UVKDSOXPMITMDGYXEIGUJSQBRAMMN';
	}`,
				messages: {
					cases: [
						{ // start a new fundraising period
							if: `{trigger.data.start AND !$asset}`,
							messages: [
								{
									app: 'asset',
									payload: {
										is_private: false,
										is_transferrable: true,
										auto_destroy: false,
										fixed_denominations: false,
										issued_by_definer_only: true,
										cosigned_by_definer: false,
										spender_attested: false
									}
								},
								{
									app: 'state',
									state: `{
							var[response_unit || '_status'] = 'open';
							var['asset'] = response_unit;
							response['asset'] = response_unit;
						}`
								}
							]
						},
						{ // contribute
							if: `{trigger.output[[asset=base]] >= 1e5 AND $asset}`,
							init: `{
					if (var[$destination_aa]['finished'])
						bounce('game over');
					$amount = trigger.output[[asset=base]] - 2000; // to account for fees we need to respond now and to refund bytes or pay shares later
					$total_raised = var['total_raised'] + $amount;
					$missing_amount = ceil((balance[$destination_aa][base] + $total_raised)*0.51) - var[$destination_aa]['team_' || $team || '_amount'];
					$bDone = ($total_raised > $missing_amount);
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{$asset}",
										outputs: [{address: "{trigger.address}", amount: "{$amount}"}]
									}
								},
								{
									if: `{$bDone}`,
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [{address: "{$destination_aa}", amount: "{$total_raised}"}]
									}
								},
								{
									if: `{$bDone}`,
									app: 'data',
									payload: {
										team: "{$team}"
									}
								},
								{
									app: 'state',
									state: `{
							if ($bDone)
								var[$asset || '_status'] = 'raised';
							else
								var['total_raised'] = $total_raised;
						}`
								}
							]
						},
						{ // received team asset
							if: `{trigger.output[[asset=var[$destination_aa]['team_' || $team || '_asset']]] AND $asset}`,
							messages: [
								{
									app: 'state',
									state: `{
							var[$asset || '_status'] = 'done';
							var['asset'] = false;
							var['total_raised'] = false;
						}`
								}
							]
						},
						{ // refund
							if: `{$asset AND trigger.output[[asset=$asset]] > 0}`,
							init: `{
					$amount = trigger.output[[asset=$asset]];
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [{address: "{trigger.address}", amount: "{$amount}"}]
									}
								},
								{
									app: 'state',
									state: `{
							var['total_raised'] -= $amount;
						}`
								}
							]
						},
						{ // pay the obtained team asset in exchange for the issued asset
							if: `{
					$in_asset = trigger.output[[asset!=base]].asset;
					var[$in_asset || '_status'] == 'done'
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{var[$destination_aa]['team_' || $team || '_asset']}",
										outputs: [{address: "{trigger.address}", amount: "{trigger.output[[asset=$in_asset]]}"}]
									}
								},
							]
						}
					]
				}
			}
		]
	)});
});

test('ICO with milestone based release of funds', t => {
	var ojson = `{
	/*
	This is an ICO agent with milestone-based release of the raised funds.

	The funds are released only after a trusted third party (an auditor) verifies the team's performance and approves the release of the next milestone payment.  The auditor can be a multisig address.

	If the ICO doesn't reach its target, the investors can get a refund by exchanging their tokens back to bytes.
	*/
	init: \`{
		$control_address = 'VF5UVKDSOXPMITMDGYXEIGUJSQBRAMMN'; // controled by the fundraiser, used to finish the ICO
		$fundraiser_address = 'VF5UVKDSOXPMITMDGYXEIGUJSQBRAMMN'; // this address receives the milestone payments
		$auditor_address = 'JE3HACDALPUAQ6SJOFM74W43EGVFWEIF';
		$price = 13.3; // bytes per token
		$target = 100e9; // if raised less, will refund
		$expiry_ts = 1577836000; // Jan 1, 2020
		$milestone1 = 10; // in %
		$milestone2 = 30;
		$milestone3 = 40;
		$milestone4 = 20;
		$asset = var['asset'];
		$finished = var['finished'];
		$is_active = ($asset AND $price AND !$finished);
	}\`,
	messages: {
		cases: [
			{ // create a token
				if: \`{trigger.data.define AND !$asset}\`,
				messages: [
					{
						app: 'asset',
						payload: {
							is_private: false,
							is_transferrable: true,
							auto_destroy: false,
							fixed_denominations: false,
							issued_by_definer_only: true,
							cosigned_by_definer: false,
							spender_attested: false
						}
					},
					{
						app: 'state',
						state: \`{
							var['asset'] = response_unit;
							response['asset'] = response_unit;
						}\`
					}
				]
			},
			{ // contribute
				if: \`{ trigger.output[[asset=base]] >= 1e5 AND $is_active }\`,
				init: \`{
					$amount = round(trigger.output[[asset=base]] / $price);
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "{$asset}",
							outputs: [{address: "{trigger.address}", amount: "{$amount}"}]
						}
					}
				]
			},
			{ // finish the ICO
				if: \`{ trigger.data.finish AND (trigger.address == $control_address OR timestamp > $expiry_ts) }\`,
				messages: [
					{
						app: 'state',
						state: \`{
							var['finished'] = 1;
							var['total'] = balance[base];
							response['total'] = balance[base];
						}\`
					}
				]
			},
			{ // release a milestone
				if: \`{trigger.data.milestone AND trigger.address == $auditor_address AND $finished AND var['total'] >= $target}\`,
				init: \`{
					$share = \${'milestone' || trigger.data.milestone} / 100;
					if (!$share)
						bounce('no such milestone');
					if (var['milestone' || trigger.data.milestone || '_released'])
						bounce('milestone ' || trigger.data.milestone || ' already released');
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [{address: "{$fundraiser_address}", amount: "{round(var['total'] * $share)}"}]
						}
					},
					{
						app: 'state',
						state: \`{
							var['milestone' || trigger.data.milestone || '_released'] = 1;
							response['released'] = 1;
						}\`
					}
				]
			},
			{ // refund
				if: \`{$asset AND trigger.output[[asset=$asset]] > 0 AND $finished AND var['total'] < $target}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: "base",
							outputs: [{address: "{trigger.address}", amount: "{ round(trigger.output[[asset=$asset]] * $price) }"}]
						}
					}
				]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$control_address = 'VF5UVKDSOXPMITMDGYXEIGUJSQBRAMMN'; // controled by the fundraiser, used to finish the ICO
		$fundraiser_address = 'VF5UVKDSOXPMITMDGYXEIGUJSQBRAMMN'; // this address receives the milestone payments
		$auditor_address = 'JE3HACDALPUAQ6SJOFM74W43EGVFWEIF';
		$price = 13.3; // bytes per token
		$target = 100e9; // if raised less, will refund
		$expiry_ts = 1577836000; // Jan 1, 2020
		$milestone1 = 10; // in %
		$milestone2 = 30;
		$milestone3 = 40;
		$milestone4 = 20;
		$asset = var['asset'];
		$finished = var['finished'];
		$is_active = ($asset AND $price AND !$finished);
	}`,
				messages: {
					cases: [
						{ // create a token
							if: `{trigger.data.define AND !$asset}`,
							messages: [
								{
									app: 'asset',
									payload: {
										is_private: false,
										is_transferrable: true,
										auto_destroy: false,
										fixed_denominations: false,
										issued_by_definer_only: true,
										cosigned_by_definer: false,
										spender_attested: false
									}
								},
								{
									app: 'state',
									state: `{
							var['asset'] = response_unit;
							response['asset'] = response_unit;
						}`
								}
							]
						},
						{ // contribute
							if: `{ trigger.output[[asset=base]] >= 1e5 AND $is_active }`,
							init: `{
					$amount = round(trigger.output[[asset=base]] / $price);
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "{$asset}",
										outputs: [{address: "{trigger.address}", amount: "{$amount}"}]
									}
								}
							]
						},
						{ // finish the ICO
							if: `{ trigger.data.finish AND (trigger.address == $control_address OR timestamp > $expiry_ts) }`,
							messages: [
								{
									app: 'state',
									state: `{
							var['finished'] = 1;
							var['total'] = balance[base];
							response['total'] = balance[base];
						}`
								}
							]
						},
						{ // release a milestone
							if: `{trigger.data.milestone AND trigger.address == $auditor_address AND $finished AND var['total'] >= $target}`,
							init: `{
					$share = \${'milestone' || trigger.data.milestone} / 100;
					if (!$share)
						bounce('no such milestone');
					if (var['milestone' || trigger.data.milestone || '_released'])
						bounce('milestone ' || trigger.data.milestone || ' already released');
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [{address: "{$fundraiser_address}", amount: "{round(var['total'] * $share)}"}]
									}
								},
								{
									app: 'state',
									state: `{
							var['milestone' || trigger.data.milestone || '_released'] = 1;
							response['released'] = 1;
						}`
								}
							]
						},
						{ // refund
							if: `{$asset AND trigger.output[[asset=$asset]] > 0 AND $finished AND var['total'] < $target}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: "base",
										outputs: [{address: "{trigger.address}", amount: "{ round(trigger.output[[asset=$asset]] * $price) }"}]
									}
								}
							]
						},
					]
				}
			}
		]
	)});
});

test('Things registry and marketplace', t => {
	var ojson = `/*

This AA allows to register and sell any things.
A thing can be anything: a physical object, a copyrighted work, a name, a NFT, ...
Each thing is identified by a unique ID.

Every thing is first registered.  When registered, it is assigned to the user who registered it.  Then, the owner can put the thing on sale and set a price. While the thing is on sale, any user can send the sell price to the AA, this amount will be forwarded to the past owner and the thing will be reassigned to the new owner.

Possible extensions:
- If a thing has a private key associated with it (e.g. the thing is a smart card a has smart card securely attached to it), send a signed message when registering in order to prove ownership.
- Allow things to be rented for a fee.
- Allow to borrow money using an owned thing as a collateral.  If the debt is not repaid in time, the lender can seize the thing.

*/

{
	init: \`{
		$id = trigger.data.id;
	}\`,
	messages: {
		cases: [
			{ // register a new thing and optionally put it on sale
				if: \`{trigger.data.register AND $id}\`,
				init: \`{
					if (var['owner_' || $id])
						bounce('thing ' || $id || ' already registered');
					if (trigger.data.sell){
						$price = trigger.data.price;
						if (!$price || !($price > 0) || round($price) != $price)
							bounce('please set a positive integer price');
					}
				}\`,
				messages: [
					{
						app: 'state',
						state: \`{
							var['owner_' || $id] = trigger.address;
							if (trigger.data.sell AND trigger.data.price)
								var['price_' || $id] = trigger.data.price;
							response['message'] = 'registered' || (trigger.data.sell AND trigger.data.price ? ' and put on sale for ' || trigger.data.price : '');
						}\`
					}
				]
			},
			{ // put a thing on sale or update its price
				if: \`{$id AND trigger.data.sell AND trigger.data.price}\`,
				init: \`{
					$owner = var['owner_' || $id];
					if (!$owner OR $owner != trigger.address)
						bounce('thing ' || $id || ' is not yours');
					if (!(trigger.data.price > 0) OR round(trigger.data.price) != trigger.data.price)
						bounce('please set an integer positive price');
				}\`,
				messages: [
					{
						app: 'state',
						state: \`{
							var['price_' || $id] = trigger.data.price;
							response['message'] = 'on sale for ' || trigger.data.price;
						}\`
					}
				]
			},
			{ // withdraw a thing from sale
				if: \`{$id AND trigger.data.withdraw_from_sale}\`,
				init: \`{
					$owner = var['owner_' || $id];
					if (!$owner OR $owner != trigger.address)
						bounce('thing ' || $id || ' is not yours');
				}\`,
				messages: [
					{
						app: 'state',
						state: \`{
							var['price_' || $id] = false; // no-price means not on sale
							response['message'] = 'withdrawn from sale';
						}\`
					}
				]
			},
			{ // buy a thing
				if: \`{$id AND trigger.data.buy}\`,
				init: \`{
					$owner = var['owner_' || $id];
					if (!$owner)
						bounce('no such thing: ' || $id);
					if ($owner == trigger.address)
						bounce('thing ' || $id || ' is already yours');
					$price = var['price_' || $id];
					if (!$price)
						bounce('thing ' || $id || ' is not on sale');
					$amount = trigger.output[[asset=base]];
					if ($amount < $price)
						bounce("the thing's price is " || $price || ", you sent only " || $amount);
					$change = $amount - $price;
				}\`,
				messages: [
					{
						app: 'payment',
						payload: {
							asset: 'base',
							outputs: [
								{address: "{$owner}", amount: "{$price}"},
								{if: "{$change > 0}", address: "{trigger.address}", amount: "{$change}"},
							]
						}
					},
					{
						app: 'state',
						state: \`{
							var['owner_' || $id] = trigger.address; // new owner
							var['price_' || $id] = false; // not on sale any more
							response['message'] = 'sold to ' || trigger.address;
						}\`
					}
				]
			},
		]
	}
}`
	parseOjson(ojson, (err, res) => { t.deepEqual(err || res,
		[
			"autonomous agent",
			{
				init: `{
		$id = trigger.data.id;
	}`,
				messages: {
					cases: [
						{ // register a new thing and optionally put it on sale
							if: `{trigger.data.register AND $id}`,
							init: `{
					if (var['owner_' || $id])
						bounce('thing ' || $id || ' already registered');
					if (trigger.data.sell){
						$price = trigger.data.price;
						if (!$price || !($price > 0) || round($price) != $price)
							bounce('please set a positive integer price');
					}
				}`,
							messages: [
								{
									app: 'state',
									state: `{
							var['owner_' || $id] = trigger.address;
							if (trigger.data.sell AND trigger.data.price)
								var['price_' || $id] = trigger.data.price;
							response['message'] = 'registered' || (trigger.data.sell AND trigger.data.price ? ' and put on sale for ' || trigger.data.price : '');
						}`
								}
							]
						},
						{ // put a thing on sale or update its price
							if: `{$id AND trigger.data.sell AND trigger.data.price}`,
							init: `{
					$owner = var['owner_' || $id];
					if (!$owner OR $owner != trigger.address)
						bounce('thing ' || $id || ' is not yours');
					if (!(trigger.data.price > 0) OR round(trigger.data.price) != trigger.data.price)
						bounce('please set an integer positive price');
				}`,
							messages: [
								{
									app: 'state',
									state: `{
							var['price_' || $id] = trigger.data.price;
							response['message'] = 'on sale for ' || trigger.data.price;
						}`
								}
							]
						},
						{ // withdraw a thing from sale
							if: `{$id AND trigger.data.withdraw_from_sale}`,
							init: `{
					$owner = var['owner_' || $id];
					if (!$owner OR $owner != trigger.address)
						bounce('thing ' || $id || ' is not yours');
				}`,
							messages: [
								{
									app: 'state',
									state: `{
							var['price_' || $id] = false; // no-price means not on sale
							response['message'] = 'withdrawn from sale';
						}`
								}
							]
						},
						{ // buy a thing
							if: `{$id AND trigger.data.buy}`,
							init: `{
					$owner = var['owner_' || $id];
					if (!$owner)
						bounce('no such thing: ' || $id);
					if ($owner == trigger.address)
						bounce('thing ' || $id || ' is already yours');
					$price = var['price_' || $id];
					if (!$price)
						bounce('thing ' || $id || ' is not on sale');
					$amount = trigger.output[[asset=base]];
					if ($amount < $price)
						bounce("the thing's price is " || $price || ", you sent only " || $amount);
					$change = $amount - $price;
				}`,
							messages: [
								{
									app: 'payment',
									payload: {
										asset: 'base',
										outputs: [
											{address: "{$owner}", amount: "{$price}"},
											{if: "{$change > 0}", address: "{trigger.address}", amount: "{$change}"},
										]
									}
								},
								{
									app: 'state',
									state: `{
							var['owner_' || $id] = trigger.address; // new owner
							var['price_' || $id] = false; // not on sale any more
							response['message'] = 'sold to ' || trigger.address;
						}`
								}
							]
						},
					]
				}
			}
		]
	)});
});
