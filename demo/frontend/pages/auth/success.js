/**
 * @name Hotel Room Booking System
 * @author Md. Samiur Rahman (Mukul)
 * @description Hotel Room Booking and Management System Software ~ Developed By Md. Samiur Rahman (Mukul)
 * @copyright ©2023 ― Md. Samiur Rahman (Mukul). All rights reserved.
 * @version v0.0.1
 */

import { useRouter } from 'next/router';
import React, { useEffect } from 'react';
import MainLayout from '../../components/layout';
import { setSessionUserAndToken } from '../../utils/authentication';
import notificationWithIcon from '../../utils/notification';

function Success() {
  const router = useRouter();
  // Query params: token, email, name (set by backend OAuth callbacks)
  const { token, email, name } = router.query;

  useEffect(() => {
    if (token && setSessionUserAndToken) {
      // Determine role from email or just use user object from backend
      const user = {
        id: email || 'social-user',
        email,
        name: name || 'Social User',
        provider: 'social'
      };
      setSessionUserAndToken(user, token, '');
      // Redirect to profile — same pattern as login success
      router.push('/profile?tab=my-profile');
    } else {
      // No valid token — go back to login
      router.push('/auth/login');
    }
  }, [token, router]);

  return null; // UI-less: just runs effect and navigates
}

export default Success;