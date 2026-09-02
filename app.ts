import { reportVisit } from './utils/analytics'

App({
  onLaunch() {
    void reportVisit()
  },
  onShow() {
    // 从后台回到前台也视为一次进入；reportVisit 内部有 30 分钟节流。
    void reportVisit()
  },
})
