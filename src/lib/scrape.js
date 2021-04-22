const qs = require("querystringify")
const { store } = require("./firebase-admin")

// https://www.bannerbear.com/blog/ways-to-speed-up-puppeteer-screenshots/
const minimal_args = [
  "--autoplay-policy=user-gesture-required",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-domain-reliability",
  "--disable-extensions",
  "--disable-features=AudioServiceOutOfProcess",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-notifications",
  "--disable-offer-store-unmasked-wallet-cards",
  "--disable-popup-blocking",
  "--disable-print-preview",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--disable-setuid-sandbox",
  "--disable-speech-api",
  "--disable-sync",
  "--hide-scrollbars",
  "--ignore-gpu-blacklist",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-pings",
  "--no-sandbox",
  "--no-zygote",
  "--password-store=basic",
  "--use-gl=swiftshader",
  "--use-mock-keychain",
]

/**
 * @param {string} tweetUrl
 */
const getDataFromTweetUrl = (tweetUrl) => {
  const urlWithoutHttps = tweetUrl.replace("https://", "")
  const split = urlWithoutHttps.split("/")
  const username = split[1]
  const tweetId = split[split.length - 1]
  return { username, tweetId, tweetUrl }
}

/**
 * @param {import("~/types").Cities} cities
 * @param {import("~/types").Resources} resources
 * @param {string[]} filterAccounts
 */
const getTweets = async (cities, resources, filterAccounts) => {
  const browser = await require("playwright").chromium.launch({
    args: minimal_args,
    headless: process.env.HEADLESS === "false" ? false : true,
  })

  const [year, month, date] = new Date()
    .toISOString()
    .slice(0, 10)
    .split("-")
    .map((i) => parseInt(i))
  const since = `${year}-${month}-${date - 1}`
  let newTweets = 0
  let done = 0
  const cityArr = Object.keys(cities).sort()

  for (const city of cityArr) {
    console.log(`Scraping data for ${city}`)
    for (const [title, searchTerm] of Object.entries(resources)) {
      const page = await browser.newPage({
        viewport: {
          width: 1920,
          height: 1080,
        },
      })

      const url =
        `https://twitter.com/search?` +
        qs.stringify({
          q: [
            "verified",
            city,
            searchTerm,
            `since:${since}`,
            'min_retweets:10 -filter:replies -"requirement" -"needed" -"needs" -"need" -"not verified" -"unverified" -"required"',
            filterAccounts.map((account) => `-from:${account}`).join(" "),
          ].join(" "),
          src: "typed_query",
          f: "live",
        })

      console.log(`Scraping data for ${city} - ${title} - ${url}`)

      await page.goto(url, {
        waitUntil: "networkidle",
      })

      const tweets = await page.evaluate(async () => {
        return await new Promise((resolve) => {
          let links = new Set()
          const timeIncrement = 100
          const timesToScroll = 1
          for (let i = 0; i <= timesToScroll; i++) {
            console.log(i, timesToScroll)
            setTimeout(() => {
              if (i === timesToScroll) {
                resolve(Array.from(new Set(Array.from(links))))
              }
              scrollBy(0, 1000)
              Array.from(document.querySelectorAll("div.r-1d09ksm > a"))
                .filter((node) => node.href !== undefined)
                .forEach((node) => {
                  if (
                    Array.from(links).filter((i) => i.tweetUrl === node.href)
                      .length === 0
                  ) {
                    links.add({
                      tweetUrl: node.href,
                      time: Array.from(node.childNodes)[0].dateTime,
                    })
                  }
                })
            }, timeIncrement * i)
          }
        })
      })

      for (const { tweetUrl, time } of tweets) {
        const metadata = getDataFromTweetUrl(tweetUrl)
        await store.doc(`tweets/${year}-${month}-${date}`).set(
          {
            [metadata.tweetId]: {
              ...metadata,
              location: {
                [city]: true,
              },
              for: {
                [title]: true,
              },
              show: true,
              status: "available",
              votes: 0,
              postedAt: new Date(time),
              createdAt: new Date(),
            },
          },
          {
            merge: true,
          }
        )
        newTweets += 1
      }
      console.log("Tweets added: ", newTweets)
      newTweets = 0
      await page.close()
    }
    done += 1
    console.log("Cities to go: ", cityArr.length - done)
  }
  await browser.close()
}

module.exports.getTweets = getTweets
