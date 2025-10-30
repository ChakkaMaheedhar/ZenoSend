import React from 'react'
import { Routes, Route, NavLink, Navigate, Outlet } from 'react-router-dom'
import ComposeCampaign from './components/ComposeCampaign'
import ContactsPage from './pages/Contacts'
import AdminUsersPage from './pages/AdminUsers'
import UploadContactsMapped from './pages/UploadContactsMapped'
import { useAuth } from './auth'

function Shell() {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="wrap">
      <div className="nav flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NavLink to="/contacts">Contacts</NavLink>
          <NavLink to="/upload-contacts">Upload &amp; Map</NavLink>
          {/* Compose visible to everyone now (admins included) */}
          <NavLink to="/compose">Compose Campaign</NavLink>
          {isAdmin && <NavLink to="/admin/users">Admin · Users</NavLink>}
        </div>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm opacity-80">{user.email} · {user.role}</span>}
          <button className="btn btn-small" onClick={logout}>Logout</button>
        </div>
      </div>
      <Outlet />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/contacts" replace />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="upload-contacts" element={<UploadContactsMapped />} />
        <Route path="compose" element={<ComposeCampaign />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
        <Route path="*" element={<Navigate to="/contacts" replace />} />
      </Route>
    </Routes>
  )
}
