const presets = [
  [
    "@babel/env",
    {
      targets: {
        node: "10"
      },
      useBuiltIns: "usage",
    },
  ],
];

const plugins = [
  "root-import"
]

module.exports = api => {
  const isTest = api.env('test');

  if (isTest) {

  }
  return {
    presets,
    plugins
  };
};
