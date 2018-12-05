'use strict';

const req = require('cheerio-req'),
  typpy = require('typpy'),
  Err = require('err'),
  objDef = require('obj-def'),
  isEmptyObject = require('is-empty-obj'),
  assured = require('assured'),
  cheerio = require('cheerio');

/**
 * scrapeIt
 * A scraping module for humans.
 *
 * @name scrapeIt
 * @function
 * @param {String|Object} url The page url or request options.
 * @param {Object} opts The options passed to `scrapeHTML` method.
 * @param {Function} cb The callback function.
 * @return {Promise} A promise object resolving with:
 *
 *   - `data` (Object): The scraped data.
 *   - `$` (Function): The Cheeerio function. This may be handy to do some other manipulation on the DOM, if needed.
 *   - `response` (Object): The response object.
 *   - `body` (String): The raw body as a string.
 *
 */
function scrapeIt(url, opts, cb) {
  const { $, res, body } = new Promise((resolve, reject) => {
    req(url, (err, $, res, body) => {
      if (err) reject(err);

      resolve($, res, body)
  });

  cb = assured(cb)

  try {
    let scrapedData = await scrapeIt.scrapeHTML($, opts);

    cb(null, {
      data: scrapedData,
      $,
      response: res,
      body,
    }
  } catch (e) {
    cb(e);
  }

  return cb._
}

/**
 * scrapeIt.scrapeHTML
 * Scrapes the data in the provided element.
 *
 * @name scrapeIt.scrapeHTML
 * @function
 * @param {Cheerio} $ The input element.
 * @param {Object} opts An object containing the scraping information.
 *
 *   If you want to scrape a list, you have to use the `listItem` selector:
 *
 *    - `listItem` (String): The list item selector.
 *    - `data` (Object): The fields to include in the list objects:
 *       - `<fieldName>` (Object|String): The selector or an object containing:
 *          - `selector` (String): The selector.
 *          - `convert` (Function): An optional function to change the key.
 *          - `how` (Function|String): A function or function name to access the
 *            key.
 *          - `attr` (String): If provided, the key will be taken based on
 *            the attribute name.
 *          - `trim` (Boolean): If `false`, the key will *not* be trimmed
 *            (default: `true`).
 *          - `closest` (String): If provided, returns the first ancestor of
 *            the given element.
 *          - `eq` (Number): If provided, it will select the *nth* element.
 *          - `texteq` (Number): If provided, it will select the *nth* direct text child.
 *            Deep text child selection is not possible yet.
 *            Overwrites the `how` value.
 *          - `listItem` (Object): An object, keeping the recursive schema of
 *            the `listItem` object. This can be used to create nested lists.
 *
 *   **Example**:
 *   ```js
 *   {
 *      articles: {
 *          listItem: ".article"
 *        , data: {
 *              createdAt: {
 *                  selector: ".date"
 *                , convert: x => new Date(x)
 *              }
 *            , title: "a.article-title"
 *            , tags: {
 *                  listItem: ".tags > span"
 *              }
 *            , content: {
 *                  selector: ".article-content"
 *                , how: "html"
 *              }
 *            , traverseOtherNode: {
 *                  selector: ".upperNode"
 *                , closest: "div"
 *                , convert: x => x.length
 *              }
 *          }
 *      }
 *   }
 *   ```
 *
 *   If you want to collect specific data from the page, just use the same
 *   schema used for the `data` field.
 *
 *   **Example**:
 *   ```js
 *   {
 *        title: ".header h1"
 *      , desc: ".header h2"
 *      , avatar: {
 *            selector: ".header img"
 *          , attr: "src"
 *        }
 *   }
 *   ```
 *
 * @returns {Object} The scraped data.
 */
scrapeIt.scrapeHTML = ($, opts) => {
  if (typeof $ === 'string') {
    $ = cheerio.load($);
  }

  return handleDataObj($, opts);
};

function handleDataObj($, data, context) {
  let pageData = {};

  for (let [key, value] of Object.entries(data)) {
    value = normalizeOpt(value);
    value.name = key;

    if (context === $ && !value.selector && !value.listItem) {
      throw new Err(
        "There is no element selected for the '<option.name>' field. Please provide a selector, list item or use nested object structure.",
        {
          option: value,
          code: 'NO_ELEMENT_SELECTED',
        },
      );
    }

    let element = value.selector ? $(value.selector, context) : context;

    // Handle lists
    if (value.listItem) {
      let items = $(value.listItem, context);

      pageData[value.name] = [];

      if (isEmptyObject(value.data)) value.data.___raw = {};

      for (let i = 0; i < items.length; ++i) {
        const doc = handleDataObj($, value.data, items.eq(i));
        const convert =
          value.convert ||
          function(x) {
            return x;
          };
        const output = convert(doc.___raw || doc);

        pageData[value.name].push(output);
      }
    } else {
      if (typpy(value.eq, Number)) {
        element = element.eq(value.eq);
      }

      if (typpy(value.texteq, Number)) {
        let children = element.contents(),
          textCounter = 0,
          found = false;

        for (let i = 0, child; (child = children[i]); i++) {
          if (child.type === 'text') {
            if (textCounter == value.texteq) {
              element = child;
              found = true;
              break;
            }

            textCounter++;
          }
        }

        if (!found) element = cheerio.load('');

        value.how = elm => elm.data;
      }

      // Handle closest
      if (value.closest) element = element.closest(value.closest);

      if (!isEmptyObject(value.data)) {
        pageData[value.name] = handleDataObj($, value.data, element);

        continue;
      }

      let key = typpy(value.how, Function) ? value.how(element) : element[value.how]();
      key = key === undefined ? '' : key;

      if (value.trimValue && typpy(key, String)) key = key.trim();

      if (value.convert) key = value.convert(key, element);

      pageData[value.name] = key;
    }
  }

  return pageData;
}

function normalizeOpt(v) {
  if (typpy(v, String)) {
    v = { selector: v };
  }

  objDef(v, 'data', {});
  objDef(v, 'how', 'text', true);

  if (v.attr) {
    v.how = element => element.attr(v.attr);
  }

  objDef(v, 'trimValue', true);
  objDef(v, 'closest', '');

  return v;
}

module.exports = scrapeIt;
