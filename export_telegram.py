#!/usr/bin/env python3
"""
VED Telegram Channel Exporter (Web Scraper Version)
====================================================
Exports posts from a public Telegram channel to static JSON files
without using the Telegram API (no api_id or api_hash required).

Requirements:
    pip install requests beautifulsoup4

Configuration:
    - TELEGRAM_CHANNEL    — channel username (default: firmaved)
    - POSTS_LIMIT         — max posts to export (default: 100)
    - POSTS_PER_PAGE      — posts per page (default: 20)
"""

import os
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import json
import re
import urllib.request
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("❌  Библиотеки не установлены. Запустите: pip install -r requirements.txt")
    sys.exit(1)

# ---------- Config ----------
CHANNEL       = os.environ.get('TELEGRAM_CHANNEL', 'firmaved')
POSTS_LIMIT   = int(os.environ.get('POSTS_LIMIT', '100'))
POSTS_PER_PAGE = int(os.environ.get('POSTS_PER_PAGE', '20'))

# Paths
BASE_DIR    = Path(__file__).resolve().parent
DATA_DIR    = BASE_DIR / 'data' / 'channels' / CHANNEL
MEDIA_DIR   = DATA_DIR / 'media'
PAGES_DIR   = DATA_DIR / 'pages'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
}

def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    PAGES_DIR.mkdir(parents=True, exist_ok=True)

def download_file(url, filename):
    """Download a file via HTTP and save it locally, returning relative path."""
    if not url:
        return None
    
    local_path = MEDIA_DIR / filename
    # Return existing if already downloaded to save time
    if local_path.exists() and local_path.stat().st_size > 0:
        return os.path.relpath(local_path, BASE_DIR).replace('\\', '/')
    
    try:
        r = requests.get(url, headers=HEADERS, stream=True, timeout=30)
        if r.status_code == 200:
            with open(local_path, 'wb') as f:
                for chunk in r.iter_content(1024):
                    f.write(chunk)
            return os.path.relpath(local_path, BASE_DIR).replace('\\', '/')
    except Exception as e:
        print(f"  ⚠️  Ошибка загрузки {url}: {e}")
    return None

def extract_channel_info(soup):
    title_el = soup.find('div', class_='tgme_channel_info_header_title_wrap')
    title = title_el.get_text(strip=True) if title_el else CHANNEL
    
    desc_el = soup.find('div', class_='tgme_channel_info_description')
    desc = desc_el.get_text(separator='\n') if desc_el else ''
    
    avatar_el = soup.find('img', class_='tgme_page_photo_image')
    avatar_url = avatar_el.get('src') if avatar_el else None
    avatar_path = download_file(avatar_url, 'channel-avatar.jpg') if avatar_url else ''
    
    return {
        'title': title,
        'username': CHANNEL,
        'description': desc,
        'avatar': avatar_path or '',
        'channel_url': f'https://t.me/{CHANNEL}',
    }

def parse_message_views(views_str):
    if not views_str:
        return 0
    views_str = views_str.strip().upper()
    if 'K' in views_str:
        return int(float(views_str.replace('K', '')) * 1000)
    if 'M' in views_str:
        return int(float(views_str.replace('M', '')) * 1000000)
    try:
        return int(views_str)
    except:
        return 0

def export_channel():
    ensure_dirs()
    print(f"🔌  Режим: Веб-парсинг (без API ключей)")
    print(f"📡  Канал: @{CHANNEL}")
    print(f"📊  Лимит постов: {POSTS_LIMIT}")

    session = requests.Session()
    session.headers.update(HEADERS)
    
    current_url = f"https://t.me/s/{CHANNEL}"
    all_posts = []
    channel_info = None

    while current_url and len(all_posts) < POSTS_LIMIT:
        print(f"📥  Загрузка страницы: {current_url}")
        try:
            r = session.get(current_url, timeout=30)
            r.raise_for_status()
        except Exception as e:
            print(f"❌  Ошибка получения страницы: {e}")
            break

        soup = BeautifulSoup(r.text, 'html.parser')
        
        if not channel_info:
            channel_info = extract_channel_info(soup)
            print(f"✅  Канал: {channel_info['title']}")
            
        messages = soup.find_all('div', class_='tgme_widget_message')
        if not messages:
            break
            
        # Parse messages from newest to oldest on the page (bottom up)
        page_posts = []
        for msg in reversed(messages):
            if len(all_posts) + len(page_posts) >= POSTS_LIMIT:
                break
                
            post_id_val = msg.get('data-post', '')
            if not post_id_val:
                continue
            
            # format: firmaved/123
            try:
                msg_id = int(post_id_val.split('/')[-1])
            except ValueError:
                continue
                
            # Date
            date_el = msg.find('time', class_='datetime')
            date_str = date_el.get('datetime') if date_el else ''
            
            # Text
            text_el = msg.find('div', class_='tgme_widget_message_text')
            text_html = ''.join(str(c) for c in text_el.contents) if text_el else ''
            text_plain = text_el.get_text(separator=' ') if text_el else ''
            
            # Views
            views_el = msg.find('span', class_='tgme_widget_message_views')
            views_count = parse_message_views(views_el.text if views_el else '0')
            
            # Forwarded
            fwd_info = {}
            fwd_el = msg.find('a', class_='tgme_widget_message_forwarded_from_name')
            if fwd_el:
                fwd_info = {
                    'label': fwd_el.text.strip(),
                    'href': fwd_el.get('href', '#')
                }
                
            # Media
            media_list = []
            
            # Photos
            photo_wraps = msg.find_all('a', class_='tgme_widget_message_photo_wrap')
            for i, p in enumerate(photo_wraps):
                style = p.get('style', '')
                match = re.search(r"url\('([^']+)'\)", style)
                if match:
                    img_url = match.group(1)
                    local_path = download_file(img_url, f"{msg_id}_photo_{i}.jpg")
                    if local_path:
                        media_list.append({'type': 'photo', 'url': local_path})
                        
            # Videos
            video_wrap = msg.find('video')
            if video_wrap:
                thumb_el = msg.find('i', class_='tgme_widget_message_video_thumb')
                thumb_url = ''
                if thumb_el:
                    match = re.search(r"url\('([^']+)'\)", thumb_el.get('style', ''))
                    if match:
                        thumb_url = match.group(1)
                
                local_thumb = download_file(thumb_url, f"{msg_id}_video_thumb.jpg") if thumb_url else ''
                media_list.append({
                    'type': 'video',
                    'url': '', # Don't download large videos
                    'thumbnail': local_thumb or '',
                    'file_name': f"{msg_id}_video.mp4"
                })
                
            # Document / Files (Web view usually links to t.me/...)
            doc_wrap = msg.find('div', class_='tgme_widget_message_document')
            if doc_wrap:
                doc_title_el = doc_wrap.find('div', class_='tgme_widget_message_document_title')
                doc_title = doc_title_el.text if doc_title_el else 'document'
                media_list.append({
                    'type': 'document',
                    'url': '',
                    'file_name': doc_title,
                    'file_size': 0,
                    'mime_type': 'application/octet-stream'
                })

            # Check if empty
            if not text_html and not media_list:
                continue
                
            post = {
                'id': msg_id,
                'date': date_str,
                'text': text_plain,
                'text_html': text_html,
                'media': media_list,
                'tg_url': f'https://t.me/{CHANNEL}/{msg_id}',
                'views': views_count,
            }
            if fwd_info:
                post['forwarded'] = fwd_info
                
            page_posts.append(post)

        all_posts.extend(page_posts)
        print(f"  📝  Спарсено постов: {len(all_posts)}")
        
        # Pagination: Find 'older posts' link
        older_link = soup.find('a', class_='tme_messages_more')
        if older_link and older_link.has_attr('href'):
            next_url = older_link['href']
            # Sometimes it's absolute, sometimes relative
            if next_url.startswith('/'):
                current_url = f"https://t.me{next_url}"
            else:
                current_url = f"https://t.me/s/{CHANNEL}{next_url}"
            time.sleep(1) # slight delay to avoid rate limiting
        else:
            print("  🏁  Достигнут конец истории канала (больше нет ссылки 'старые посты')")
            break

    # We collected posts going backwards (newest -> oldest). 
    # They are already in descending date order inside `all_posts`!
    
    # Just in case, sort by id descending
    all_posts.sort(key=lambda x: x['id'], reverse=True)

    # Split into pages
    total_pages = max(1, (len(all_posts) + POSTS_PER_PAGE - 1) // POSTS_PER_PAGE)

    page1_posts = all_posts[:POSTS_PER_PAGE]
    main_data = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'channel': channel_info or {'title': CHANNEL, 'username': CHANNEL},
        'total_pages': total_pages,
        'posts': page1_posts,
    }

    posts_json = DATA_DIR / 'posts.json'
    with open(posts_json, 'w', encoding='utf-8') as f:
        json.dump(main_data, f, ensure_ascii=False, indent=2)
    print(f"💾  Сохранено: {posts_json}")

    for page_num in range(2, total_pages + 1):
        start = (page_num - 1) * POSTS_PER_PAGE
        end = start + POSTS_PER_PAGE
        page_posts = all_posts[start:end]

        page_data = {
            'generated_at': main_data['generated_at'],
            'total_pages': total_pages,
            'page': page_num,
            'posts': page_posts,
        }

        page_json = PAGES_DIR / f'{page_num}.json'
        with open(page_json, 'w', encoding='utf-8') as f:
            json.dump(page_data, f, ensure_ascii=False, indent=2)
        print(f"💾  Сохранено: {page_json}")

    print(f"\n🎉  Экспорт завершён! Всего {len(all_posts)} постов на {total_pages} стр.")

if __name__ == '__main__':
    export_channel()
