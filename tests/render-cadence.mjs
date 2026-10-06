// Test-only presentation control. Every native physics tick and browser input
// still runs. Comparing this replay with the fully rendered driver checks that
// rendering cadence cannot change the race. Live performance tests don't use it.
export async function setRenderCadence(page, stride = 16) {
  await page.frames()[1].evaluate(stride => {
    const render = atlas.render.bind(atlas)
    window.testRendering = { requested: 0, presented: 0, stride }
    atlas.render = id => {
      window.testRendering.requested++
      if (window.testRendering.requested % stride === 0) {
        render(id); window.testRendering.presented++
      }
    }
    window.presentTestFrame = () => {
      render(document.querySelector('canvas').id)
      window.testRendering.presented++
    }
  }, stride)
}
export async function presentFrame(page) {
  await page.frames()[1].evaluate(() => window.presentTestFrame())
}
