Pod::Spec.new do |s|
  s.name           = 'VideoComposer'
  s.version        = '1.0.0'
  s.summary        = 'Multi-clip trim/speed composition and export for reels'
  s.description    = 'Local Expo module: AVMutableComposition-based concat/trim/speed export.'
  s.author         = 'ika'
  s.homepage       = 'https://example.invalid/video-composer'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
