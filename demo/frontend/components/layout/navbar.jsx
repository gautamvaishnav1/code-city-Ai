/**
 * @name Hotel Room Booking System
 * @author Md. Samiur Rahman (Mukul)
 * @description Hotel Room Booking and Management System Software ~ Developed By Md. Samiur Rahman (Mukul)
 * @copyright ©2023 ― Md. Samiur Rahman (Mukul). All rights reserved.
 * @version v0.0.1
 */

import { Button } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useState } from 'react';
import { FaAlignRight } from 'react-icons/fa';
import { getSessionToken, getSessionUser } from '../../utils/authentication';
import UserPopover from './popover';

function Navbar() {
  const [isOpen, setIsOpen] = useState();
  const user = getSessionUser();
  const token = getSessionToken();
  const router = useRouter();

  return (
    <nav className='navbar'>
      <div className='nav-center'>
        <div className='nav-header'>
          {/* app logo */}
          <Link href='/'>
            <img src='/images//svg/logo.svg' alt='Reach Resort' />
          </Link>

          {/* navbar toggle button */}
          <button
            className='nav-btn'
            onClick={() => setIsOpen(!isOpen)}
            type='button'
          >
            <FaAlignRight className='nav-icon' />
          </button>

        </div>

        {/* OAuth buttons — shown when user is not authenticated */}
        {!user?.id && !token && (
          <div style={{ marginRight: '120px', display: 'flex', alignItems: 'center' }}>
            <Button
              type="link"
              onClick={() => window.location.href='/api/v1/auth/google'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M22.16 11.53a9.96 9.96 0 0 1-2.94.92c.03-.91.05-1.83.05-2.75 0-1.27-.16-2.46-.47-3.63-.36.19-1.03.25-2.08.23-.11.01-.22.01-.33.01-.96 0-1.78-.02-2.56-.1-1.23-.07-2.36-.13-3.44-.14-.08-.07-.16-.07-.25-.07-.15 0-.29.01-.42.02s-.27.03-.42.05c-.66.1-1.22.32-1.68.63-.08.05-.16.1-.22.12s-.15.08-.22.12c-.41.23-.73.57-1.02.98-.06.07-.12.13-.18.2s-.06.06-.08.1zM7.33 17.05a5.97 5.97 0 0 1-1.08-.13 5.99 5.99 0 0 1-1.08.13 6.07 6.07 0 0 0-1.81 1.21 3.06 3.06 0 0 0-.6 2.23.98.98 0 0 0 .6 2.16 5.91 5.91 0 0 1 1.81.13 6.05 6.05 0 0 1 1.81-.13 3.05 3.05 0 0 0 .6-2.16 3.07 3.07 0 0 0-.6-2.23c-.01-.66-.02-1.35-.02-2.04 0-2.96 2.18-3.7 5.38-3.7 1.39 0 2.64.45 3.67 1.3 1.03-.97 2.09-1.5 3.56-1.51 9.12.01 9.64-.01 9.65-.01-1.16-.17-2.2-.44-3.15-.66-.2-.11-.2-.16-.2-.2s-.05-.05-.08-.08c-.66-.2-1.26-.4-1.78-.75zM12 5.37a4.63 4.63 0 1 0 0 9.26 4.63 4.63 0 0 0 0-9.26zM12 2.71a9.98 9.98 0 1 1 0 19.96 9.98 9.98 0 0 1 0-19.96z" />
              </svg> Google
            </Button>
            <Button
              type="link"
              onClick={() => window.location.href='/api/v1/auth/github'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577a7.951 7.951 0 0 0-1.814-1.04 3.068 3.068 0 0 0-2.607.768 7.938 7.938 0 0 0-2.307-2.288l-.563-.563a5.994 5.994 0 0 0-3.47 2.547 5.939 5.939 0 0 0 2.305 3.096 5.996 5.996 0 0 0 3.468-2.547l.563.563c2.194-.257 3.527-1.035 3.527-2.31 0-1.273-.738-2.223-1.987-2.405-.98-.096-1.96-.4-2.73-.88a5.954 5.954 0 0 0-.788-2.657 5.998 5.998 0 0 0-2.547-2.155l-.532-.532a7.972 7.972 0 0 0-2.288-3.47 7.926 7.926 0 0 0-2.288 3.47l.532.532c-.778 1.63-.98 3.66-.98 5.907 0 3.309 1.68 6.033 3.878 6.908 1.522.578 1.087.96 1.75.96s.899-.11.899-.5v.053c0 2.014.87 3.93 2.292 4.304 1.422.365 2.877.53 4.377.53 2.22 0 3.627-.504 4.6-1.5 1.1-.127 1.88-.4 2.31-.836a7.989 7.989 0 0 0 2.74-2.255 5.996 5.996 0 0 0-1.048-3.961 5.998 5.998 0 0 0-3.668-1.997l-.528-.528z" />
              </svg> GitHub
            </Button>
          </div>
        )}

        {/* navbar login button */}
        {user?.id && token ? (<UserPopover />) : (
          <Button
            style={{ position: 'absolute', right: '100px', top: '20px' }}
            onClick={() => router.push('/auth/login')}
            type='primary'
            size='large'
          >
            Log In
          </Button>
        )}

        {/* navbar link */}
        <ul className={isOpen ? 'nav-links show-nav' : 'nav-links'}>
          <li>
            <Link href='/'>Home</Link>
          </li>
          <li>
            <Link href='/rooms'>Rooms</Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}

export default Navbar;