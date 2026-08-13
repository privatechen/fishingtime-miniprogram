import { registerWithUsername } from '../../utils/auth'

Component({
  properties: {
    visible: { type: Boolean, value: false },
  },

  data: {
    username: '',
    error: '',
    submitting: false,
  },

  methods: {
    onInput(e: WechatMiniprogram.Input) {
      this.setData({ username: e.detail.value, error: '' })
    },

    /** 确认：调后端注册（昵称=用户名），成功触发 confirmed，失败展示错误 */
    onConfirm() {
      const name = this.data.username.trim()
      if (name.length < 3 || name.length > 32) {
        this.setData({ error: '用户名需 3~32 个字符' })
        return
      }
      if (this.data.submitting) return
      this.setData({ submitting: true })
      registerWithUsername(name).then((res) => {
        this.setData({ submitting: false })
        if (res.ok) {
          this.setData({ username: '', error: '' })
          this.triggerEvent('confirmed')
        } else {
          this.setData({ error: res.message || '注册失败' })
        }
      })
    },

    onClose() {
      if (this.data.submitting) return
      this.setData({ username: '', error: '' })
      this.triggerEvent('close')
    },

    /** 空操作：阻止弹层内容冒泡关闭 */
    noop() {},
  },
})
