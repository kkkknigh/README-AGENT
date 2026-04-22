import { createRouter, createWebHistory } from "vue-router"

const workbench = () => import("../layouts/WorkbenchLayout.vue")

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "workbench",
      component: workbench,
    },
    {
      path: "/reader",
      name: "reader",
      component: workbench,
    },
    {
      path: "/library",
      name: "library",
      component: workbench,
    },
    {
      path: "/profile",
      name: "profile",
      component: workbench,
    },
    {
      path: "/tag-graph",
      name: "tag-graph",
      component: workbench,
    },
    {
      path: "/login",
      redirect: "/",
    },
    {
      path: "/register",
      redirect: "/",
    },
    {
      path: "/admin",
      component: () => import("../layouts/AdminLayout.vue"),
      children: [
        {
          path: "",
          name: "admin-dashboard",
          component: () => import("../components/admin/AdminDashboard.vue"),
        },
        {
          path: "users",
          name: "admin-users",
          component: () => import("../components/admin/AdminUsers.vue"),
        },
        {
          path: "invite-codes",
          name: "admin-invite-codes",
          component: () => import("../components/admin/AdminInviteCodes.vue"),
        },
      ],
    },
  ],
})

export default router
