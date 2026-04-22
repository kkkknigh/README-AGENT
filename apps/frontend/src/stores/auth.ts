import { computed, ref } from "vue"
import { defineStore } from "pinia"
import router from "../router"

const DESKTOP_USER = {
  id: "desktop-user",
  username: "Desktop User",
  email: "desktop@local",
  role: "super_admin",
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref(DESKTOP_USER)
  const authChecked = ref(false)

  const isLoggedIn = computed(() => true)
  const isAdmin = computed(() => true)
  const isSuperAdmin = computed(() => true)

  async function checkAuth() {
    user.value = DESKTOP_USER
    authChecked.value = true
  }

  async function onLoginSuccess(_user?: unknown, _remember?: boolean) {
    user.value = DESKTOP_USER
    authChecked.value = true
    await router.push("/library")
  }

  async function onRegisterSuccess(_user?: unknown) {
    user.value = DESKTOP_USER
    authChecked.value = true
    await router.push("/library")
  }

  async function handleLogout() {
    user.value = DESKTOP_USER
    authChecked.value = true
    await router.push("/library")
  }

  return {
    user,
    authChecked,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    checkAuth,
    onLoginSuccess,
    onRegisterSuccess,
    handleLogout,
  }
})
